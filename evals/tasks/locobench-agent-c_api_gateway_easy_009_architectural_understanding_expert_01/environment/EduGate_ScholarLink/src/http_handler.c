/*
 * EduGate ScholarLink - HTTP Handler
 *
 * File:    http_handler.c
 * Project: api_gateway
 * Author:  EduGate Engineering Team
 *
 * Description:
 *   Core HTTP handling logic built on top of GNU libmicrohttpd.  The handler
 *   is responsible for:
 *     1. Accepting/aggregating inbound HTTP requests
 *     2. Invoking request-validation and routing engines
 *     3. Forwarding the request to the appropriate downstream micro-service
 *     4. Transforming/normalising responses
 *     5. Capturing metrics and emitting structured logs
 *
 *   NOTE: This file purposefully keeps external component interactions
 *         abstract to preserve loose-coupling with the rest of the gateway.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <time.h>
#include <errno.h>
#include <inttypes.h>
#include <signal.h>

#include <microhttpd.h>

#include "router.h"
#include "validator.h"
#include "metrics.h"
#include "error.h"
#include "logger.h"
#include "gateway_config.h"
#include "backend_proxy.h"

/* ------------------------------------------------------------------------- */
/* Configuration                                                             */
/* ------------------------------------------------------------------------- */

#ifndef DEFAULT_HTTP_PORT
#   define DEFAULT_HTTP_PORT 8080
#endif

#ifndef MAX_REQUEST_BODY
#   define MAX_REQUEST_BODY (1024 * 1024 * 5)   /* 5 MiB */
#endif

#ifndef READ_BLOCK_SIZE
#   define READ_BLOCK_SIZE 8192
#endif

/* ------------------------------------------------------------------------- */
/* Data Structures                                                           */
/* ------------------------------------------------------------------------- */

typedef struct
{
    char               *url;
    char               *method;
    char               *version;
    struct timespec     ts_start;

    /* Body aggregation */
    char               *body;
    size_t              body_size;
    size_t              body_capacity;

    /* Downstream response */
    char               *resp_body;
    size_t              resp_body_size;
    unsigned int        resp_status;

    /* Tracking */
    int                 validated;
    int                 routed;
} request_ctx_t;

/* ------------------------------------------------------------------------- */
/* Utility Helpers                                                           */
/* ------------------------------------------------------------------------- */

/* Monotonic timestamp in milliseconds */
static inline uint64_t
epoch_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000ULL + ts.tv_nsec / 1000000ULL;
}

/* Allocate (or grow) the body buffer for streaming payloads */
static int
reserve_body_buf(request_ctx_t *ctx, size_t desired_cap)
{
    if (desired_cap > MAX_REQUEST_BODY) {
        return -1;
    }

    if (desired_cap <= ctx->body_capacity)
        return 0;

    char *tmp = realloc(ctx->body, desired_cap);
    if (!tmp)
        return -1;

    ctx->body = tmp;
    ctx->body_capacity = desired_cap;
    return 0;
}

/* Compose JSON error response */
static struct MHD_Response *
json_error_response(unsigned int status_code, const char *fmt, ...)
{
    char msg[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);

    char payload[512];
    int len = snprintf(payload, sizeof(payload),
                       "{ \"error\": { \"code\": %u, \"message\": \"%s\" } }",
                       status_code, msg);

    return MHD_create_response_from_buffer((size_t)len,
                                           (void *)strdup(payload),
                                           MHD_RESPMEM_MUST_FREE);
}

/* ------------------------------------------------------------------------- */
/* Request Lifecycle                                                         */
/* ------------------------------------------------------------------------- */

static int
on_request_completed(void *cls,
                     struct MHD_Connection *connection,
                     void **con_cls,
                     enum MHD_RequestTerminationCode toe)
{
    (void)cls; (void)connection; (void)toe;

    request_ctx_t *ctx = *con_cls;
    if (!ctx)
        return MHD_YES;

    /* Metrics collection */
    uint64_t start_ms = (uint64_t)ctx->ts_start.tv_sec * 1000ULL
                      + ctx->ts_start.tv_nsec / 1000000ULL;
    uint64_t dur_ms = epoch_ms() - start_ms;

    metrics_record_request(ctx->method,
                           ctx->url,
                           ctx->resp_status ? ctx->resp_status : 500,
                           dur_ms);

    log_info("[HTTP] %s %s -> %u [%lums]",
             ctx->method,
             ctx->url,
             ctx->resp_status,
             (unsigned long)dur_ms);

    /* Free resources */
    free(ctx->url);
    free(ctx->method);
    free(ctx->version);
    free(ctx->body);
    free(ctx->resp_body);
    free(ctx);
    *con_cls = NULL;

    return MHD_YES;
}

/* Main per-request handler (libmicrohttpd) */
static int
http_router_callback(void *cls,
                     struct MHD_Connection *connection,
                     const char *url,
                     const char *method,
                     const char *version,
                     const char *upload_data,
                     size_t *upload_data_size,
                     void **con_cls)
{
    (void)cls; (void)version;

    request_ctx_t *ctx = *con_cls;

    /* -------------------- 1st call – create ctx -------------------------- */
    if (!ctx) {
        ctx = calloc(1, sizeof(*ctx));
        if (!ctx)
            return MHD_NO; /* OOM */

        clock_gettime(CLOCK_MONOTONIC, &ctx->ts_start);
        ctx->url     = strdup(url);
        ctx->method  = strdup(method);
        ctx->version = strdup(version);
        *con_cls     = ctx;

        /* Signal libmicrohttpd that we need more data */
        return MHD_YES;
    }

    /* -------------------- Body Aggregation ------------------------------- */
    if (*upload_data_size) {
        /* Grow buffer if needed */
        if (reserve_body_buf(ctx, ctx->body_size + *upload_data_size + 1) < 0) {
            struct MHD_Response *err_resp =
                json_error_response(MHD_HTTP_PAYLOAD_TOO_LARGE,
                                    "Payload exceeds maximum allowed size");
            int ret = MHD_queue_response(connection,
                                         MHD_HTTP_PAYLOAD_TOO_LARGE,
                                         err_resp);
            MHD_destroy_response(err_resp);
            ctx->resp_status = MHD_HTTP_PAYLOAD_TOO_LARGE;
            return ret;
        }

        memcpy(ctx->body + ctx->body_size, upload_data, *upload_data_size);
        ctx->body_size += *upload_data_size;
        ctx->body[ctx->body_size] = '\0';

        *upload_data_size = 0;           /* Marker: data consumed */
        return MHD_YES;
    }

    /* -------------------- Validation ------------------------------------- */
    if (!ctx->validated) {
        int vrc = validator_validate_request(connection,
                                             ctx->method,
                                             ctx->url,
                                             ctx->body,
                                             ctx->body_size);
        ctx->validated = 1;

        if (vrc != 0) {
            struct MHD_Response *err_resp =
                json_error_response(MHD_HTTP_BAD_REQUEST,
                                    "Validation error (%d)", vrc);
            int ret = MHD_queue_response(connection,
                                         MHD_HTTP_BAD_REQUEST,
                                         err_resp);
            MHD_destroy_response(err_resp);
            ctx->resp_status = MHD_HTTP_BAD_REQUEST;
            return ret;
        }
    }

    /* -------------------- Routing ---------------------------------------- */
    router_target_t target;
    if (!ctx->routed) {
        int rrc = router_resolve(ctx->url, ctx->method, &target);
        ctx->routed = 1;

        if (rrc != 0) {
            struct MHD_Response *err_resp =
                json_error_response(MHD_HTTP_NOT_FOUND,
                                    "No route for %s %s", ctx->method, ctx->url);
            int ret = MHD_queue_response(connection,
                                         MHD_HTTP_NOT_FOUND,
                                         err_resp);
            MHD_destroy_response(err_resp);
            ctx->resp_status = MHD_HTTP_NOT_FOUND;
            return ret;
        }
    }

    /* -------------------- Proxy & Response ------------------------------- */
    backend_response_t bresp;
    memset(&bresp, 0, sizeof(bresp));

    int prc = backend_proxy_forward(&target,
                                    ctx->method,
                                    connection,   /* for headers */
                                    ctx->body,
                                    ctx->body_size,
                                    &bresp);
    if (prc != 0) {
        struct MHD_Response *err_resp =
            json_error_response(MHD_HTTP_BAD_GATEWAY,
                                "Failed to reach downstream service");
        int ret = MHD_queue_response(connection,
                                     MHD_HTTP_BAD_GATEWAY,
                                     err_resp);
        MHD_destroy_response(err_resp);
        ctx->resp_status = MHD_HTTP_BAD_GATEWAY;
        backend_proxy_free(&bresp);
        return ret;
    }

    /* Queue downstream response back to client */
    struct MHD_Response *resp =
        MHD_create_response_from_buffer(bresp.body_size,
                                        (void *)bresp.body,
                                        MHD_RESPMEM_MUST_FREE);
    for (size_t i = 0; i < bresp.header_count; ++i) {
        MHD_add_response_header(resp,
                                bresp.headers[i].name,
                                bresp.headers[i].value);
    }

    int ret = MHD_queue_response(connection, bresp.http_status, resp);
    ctx->resp_status = bresp.http_status;

    MHD_destroy_response(resp);
    backend_proxy_clear_headers(&bresp);   /* Body ownership moved to resp */

    return ret;
}

/* ------------------------------------------------------------------------- */
/* HTTP Server Lifecycle                                                     */
/* ------------------------------------------------------------------------- */

static volatile sig_atomic_t g_should_stop = 0;

static void
signal_handler(int sig)
{
    (void)sig;
    g_should_stop = 1;
}

int
http_server_start(const gateway_config_t *cfg)
{
    struct MHD_Daemon *daemon;
    unsigned int port = cfg ? cfg->listen_port : DEFAULT_HTTP_PORT;

    daemon = MHD_start_daemon(
        MHD_USE_AUTO | MHD_USE_INTERNAL_POLLING_THREAD,
        port,
        NULL, NULL,                     /* accept policy  */
        &http_router_callback, NULL,    /* request handler */
        MHD_OPTION_CONNECTION_TIMEOUT,  (unsigned int)cfg->connection_timeout_sec,
        MHD_OPTION_NOTIFY_COMPLETED,    &on_request_completed, NULL,
        MHD_OPTION_END);
    if (!daemon) {
        log_fatal("Failed to spawn HTTP daemon on port %u", port);
        return -1;
    }

    log_info("HTTP server started on port %u", port);

    signal(SIGINT,  signal_handler);
    signal(SIGTERM, signal_handler);

    while (!g_should_stop) {
        /* A lightweight sleep to keep CPU usage low in the main loop */
        struct timespec ts = { .tv_sec = 0, .tv_nsec = 200 * 1000000 }; /* 200ms */
        nanosleep(&ts, NULL);
    }

    log_info("Shutting down HTTP server…");
    MHD_stop_daemon(daemon);
    return 0;
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                */
/* ------------------------------------------------------------------------- */

#ifdef BUILD_STANDALONE_GATEWAY
/* When compiled with -DBUILD_STANDALONE_GATEWAY this file provides
 * a minimal runnable gateway (for development/testing). */
int
main(int argc, char *argv[])
{
    (void)argc; (void)argv;

    gateway_config_t cfg = {
        .listen_port             = DEFAULT_HTTP_PORT,
        .connection_timeout_sec  = 30
    };

    logger_init(LOG_LEVEL_INFO);

    if (http_server_start(&cfg) != 0) {
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
#endif /* BUILD_STANDALONE_GATEWAY */

/* ------------------------------------------------------------------------- */
/* End of File                                                               */
/* ------------------------------------------------------------------------- */
