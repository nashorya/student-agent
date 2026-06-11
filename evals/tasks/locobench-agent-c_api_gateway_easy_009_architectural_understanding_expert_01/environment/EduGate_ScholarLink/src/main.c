/*
 * EduGate ScholarLink - main.c
 *
 * Entry point for the EduGate ScholarLink API-Gateway.
 *
 * This file wires together configuration loading, request routing,
 * basic request validation, error handling, metrics reporting and
 * graceful shutdown.  It relies on the lightweight HTTP server
 * “GNU libmicrohttpd” (https://www.gnu.org/software/libmicrohttpd/)
 * to keep external dependencies minimal while providing a production-
 * ready networking stack.
 *
 * NOTE:
 *  - Build with:  gcc -std=c11 -Wall -Wextra -pedantic -pthread \
 *                 main.c -lmicrohttpd -o edugate_gateway
 *
 *  - Runtime configuration (port etc.) can be supplied via environment
 *    variables.  Sensible defaults are provided to keep the quick-start
 *    experience smooth for students.
 */

#define _POSIX_C_SOURCE 200809L /* sigaction, strdup, etc. */

#include <microhttpd.h>

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>

/* ------------------------------------------------------------------------- */
/* Compile-time / run-time configuration                                     */
/* ------------------------------------------------------------------------- */

#define DEFAULT_LISTEN_PORT     8080
#define DEFAULT_THREAD_POOL     8
#define DEFAULT_CONN_BACKLOG    1024
#define JSON_CONTENT_TYPE       "application/json; charset=utf-8"
#define TEXT_CONTENT_TYPE       "text/plain; charset=utf-8"
#define GATEWAY_VERSION         "v2024_Spring"

/* ------------------------------------------------------------------------- */
/* Simple logging utility                                                    */
/* ------------------------------------------------------------------------- */

static void
log_line(const char *level, const char *msg)
{
    time_t     now   = time(NULL);
    struct tm  ts;
    char       tsbuf[32];

    localtime_r(&now, &ts);
    strftime(tsbuf, sizeof(tsbuf), "%Y-%m-%d %H:%M:%S", &ts);

    fprintf(stderr, "[%s] %-5s  %s\n", tsbuf, level, msg);
}

/* Macro for syntactic sugar */
#define LOG_INFO(msg)   log_line("INFO",  (msg))
#define LOG_WARN(msg)   log_line("WARN",  (msg))
#define LOG_ERROR(msg)  log_line("ERROR", (msg))

/* ------------------------------------------------------------------------- */
/* Metrics (very minimal Prometheus style)                                   */
/* ------------------------------------------------------------------------- */

static atomic_ulong g_total_requests   = 0;
static atomic_ulong g_failed_requests  = 0;
static atomic_ulong g_active_connections = 0;

/* Return a freshly allocated C-string with metrics in Prometheus format.
 * Caller is responsible for free(3).
 */
static char *
metrics_dump_prometheus(void)
{
    /* Estimate worst-case size up-front, keeps reallocs away */
    char *buf = malloc(512);
    if (!buf)
        return NULL;

    unsigned long total   = atomic_load_explicit(&g_total_requests,
                                                 memory_order_relaxed);
    unsigned long failed  = atomic_load_explicit(&g_failed_requests,
                                                 memory_order_relaxed);
    unsigned long active  = atomic_load_explicit(&g_active_connections,
                                                 memory_order_relaxed);

    int sz = snprintf(buf, 512,
        "# HELP edugate_total_requests The total number of HTTP requests processed.\n"
        "# TYPE edugate_total_requests counter\n"
        "edugate_total_requests %lu\n"
        "# HELP edugate_failed_requests The total number of failed HTTP requests.\n"
        "# TYPE edugate_failed_requests counter\n"
        "edugate_failed_requests %lu\n"
        "# HELP edugate_active_connections The current number of open HTTP connections.\n"
        "# TYPE edugate_active_connections gauge\n"
        "edugate_active_connections %lu\n",
        total, failed, active);

    if (sz < 0) { free(buf); return NULL; }

    /* Shrink to fit to save memory (not strictly necessary) */
    char *shrunk = realloc(buf, (size_t)sz + 1);
    return shrunk ? shrunk : buf; /* keep original if realloc failed */
}

/* ------------------------------------------------------------------------- */
/* Simple request validation                                                 */
/* ------------------------------------------------------------------------- */

static bool
validate_student_id_header(struct MHD_Connection *conn)
{
    const char *student_id =
        MHD_lookup_connection_value(conn, MHD_HEADER_KIND, "X-Student-Id");

    /* For tech demonstration we only care that the header exists and is non-empty */
    return (student_id && *student_id);
}

/* ------------------------------------------------------------------------- */
/* Response helpers                                                          */
/* ------------------------------------------------------------------------- */

static int
respond(struct MHD_Connection *conn, unsigned int status_code,
        const char *content_type, const char *payload)
{
    struct MHD_Response *resp = MHD_create_response_from_buffer(strlen(payload),
                                    (void *)payload, MHD_RESPMEM_MUST_COPY);
    if (!resp)
        return MHD_NO; /* out of memory */

    MHD_add_response_header(resp, "Content-Type", content_type);
    MHD_add_response_header(resp, "Server", "EduGate-ScholarLink");

    int ret = MHD_queue_response(conn, status_code, resp);
    MHD_destroy_response(resp);
    return ret;
}

static inline int
respond_json(struct MHD_Connection *conn, unsigned int code,
             const char *json)
{
    return respond(conn, code, JSON_CONTENT_TYPE, json);
}

static inline int
respond_text(struct MHD_Connection *conn, unsigned int code,
             const char *text)
{
    return respond(conn, code, TEXT_CONTENT_TYPE, text);
}

/* ------------------------------------------------------------------------- */
/* URI Handlers                                                              */
/* ------------------------------------------------------------------------- */

/* Health check endpoint */
static int
handle_health(struct MHD_Connection *conn)
{
    const char *json = "{ \"status\": \"up\" }";
    return respond_json(conn, MHD_HTTP_OK, json);
}

/* /admin/metrics – returns Prometheus metrics */
static int
handle_metrics(struct MHD_Connection *conn)
{
    char *dump = metrics_dump_prometheus();
    if (!dump)
        return MHD_NO; /* ENOMEM */

    int ret = respond_text(conn, MHD_HTTP_OK, dump);
    free(dump);
    return ret;
}

/* /v1/course – stub REST endpoint */
static int
handle_course(struct MHD_Connection *conn, const char *method)
{
    if (strcmp(method, MHD_HTTP_METHOD_GET) != 0)
        return respond_json(conn, MHD_HTTP_METHOD_NOT_ALLOWED,
                            "{ \"error\": \"Method not allowed\" }");

    if (!validate_student_id_header(conn))
        return respond_json(conn, MHD_HTTP_UNAUTHORIZED,
                            "{ \"error\": \"Missing X-Student-Id header\" }");

    const char *json =
        "{ \"courseId\": \"CS101\", \"title\": \"Intro to Programming\","
        "  \"credits\": 4 }";
    return respond_json(conn, MHD_HTTP_OK, json);
}

/* /v1/quiz GraphQL stub endpoint */
static int
handle_quiz_graphql(struct MHD_Connection *conn, const char *method,
                    const char *upload_data, size_t *upload_data_size,
                    bool *consumed_upload)
{
    /* Accept POST only */
    if (strcmp(method, MHD_HTTP_METHOD_POST) != 0)
        return respond_json(conn, MHD_HTTP_METHOD_NOT_ALLOWED,
                            "{ \"error\": \"Use POST for GraphQL\" }");

    if (!validate_student_id_header(conn))
        return respond_json(conn, MHD_HTTP_UNAUTHORIZED,
                            "{ \"error\": \"Missing X-Student-Id header\" }");

    /* libmicrohttpd passes upload_data in chunks: consume exactly once */
    if (*upload_data_size > 0) {
        /* Very naive echo of GraphQL query for demonstration */
        *consumed_upload = true;
        char *query = strndup(upload_data, *upload_data_size);
        if (!query)
            return MHD_NO; /* ENOMEM */

        char *resp_buf = malloc(strlen(query) + 64);
        if (!resp_buf) {
            free(query);
            return MHD_NO;
        }

        sprintf(resp_buf,
                "{ \"acknowledged\": true, \"query\": \"%s\" }", query);

        int ret = respond_json(conn, MHD_HTTP_OK, resp_buf);
        free(query);
        free(resp_buf);
        *upload_data_size = 0; /* signal we processed all data */
        return ret;
    }

    /* upload_data_size == 0 means we're done; the response has already been sent */
    return MHD_YES;
}

/* ------------------------------------------------------------------------- */
/* Routing                                                                   */
/* ------------------------------------------------------------------------- */

typedef enum {
    ROUTE_TYPE_SIMPLE,     /* GET /path */
    ROUTE_TYPE_GRAPHQL     /* POST /path – with streaming body  */
} route_type_t;

typedef struct {
    const char    *path;
    route_type_t   type;
    int (*handler)(struct MHD_Connection *conn,
                   const char *method,
                   const char *upload_data, size_t *upload_data_size,
                   bool *consumed_upload); /* for GRAPHQL */
    int (*simple_handler)(struct MHD_Connection *conn,
                          const char *method); /* for SIMPLE */
} route_t;

/* Pre-defined route table.
 * In a full implementation this could be dynamic or loaded from config.
 */
static const route_t g_routes[] = {
    { "/health",      ROUTE_TYPE_SIMPLE,   NULL,                handle_health },
    { "/admin/metrics", ROUTE_TYPE_SIMPLE, NULL,                handle_metrics },
    { "/v1/course",   ROUTE_TYPE_SIMPLE,   NULL,                handle_course },
    { "/v1/quiz",     ROUTE_TYPE_GRAPHQL,  handle_quiz_graphql, NULL          },
};

static const size_t g_route_count = sizeof(g_routes) / sizeof(g_routes[0]);

/* Main MHD callback */
static int
ahc_router_cb(void *cls,
              struct MHD_Connection *conn,
              const char *url, const char *method,
              const char *version,
              const char *upload_data, size_t *upload_data_size,
              void **con_cls)
{
    (void)cls;
    (void)version;

    /* On first call for a connection, *con_cls is NULL.  We use it to track
     * whether we’ve already processed the request body.
     */
    bool consumed_upload = (*con_cls != NULL);

    /* Dispatch to appropriate route */
    for (size_t i = 0; i < g_route_count; ++i) {
        if (strcmp(url, g_routes[i].path) == 0) {
            int ret;
            if (g_routes[i].type == ROUTE_TYPE_SIMPLE) {
                /* No streaming body: process only once when upload_data_size==0 */
                if (*upload_data_size != 0)
                    return MHD_YES; /* ignore body */
                ret = g_routes[i].simple_handler(conn, method);
            } else { /* GraphQL or other streaming */
                ret = g_routes[i].handler(conn, method,
                                          upload_data, upload_data_size,
                                          &consumed_upload);
            }

            /* Mark that we have consumed upload so MHD can free buffers */
            if (!*con_cls && consumed_upload)
                *con_cls = (void *)1;

            /* Update metrics */
            atomic_fetch_add_explicit(&g_total_requests, 1,
                                      memory_order_relaxed);
            if (ret != MHD_YES && ret != MHD_QUEUE) {
                atomic_fetch_add_explicit(&g_failed_requests, 1,
                                          memory_order_relaxed);
            }

            return ret;
        }
    }

    /* No matching route */
    atomic_fetch_add_explicit(&g_total_requests, 1, memory_order_relaxed);
    atomic_fetch_add_explicit(&g_failed_requests, 1,  memory_order_relaxed);
    return respond_json(conn, MHD_HTTP_NOT_FOUND,
                        "{ \"error\": \"Not found\" }");
}

/* ------------------------------------------------------------------------- */
/* Graceful shutdown handling                                                */
/* ------------------------------------------------------------------------- */

static volatile sig_atomic_t g_stop_flag = 0;

static void
on_signal(int signo)
{
    (void)signo;
    g_stop_flag = 1;
}

/* ------------------------------------------------------------------------- */
/* Main                                                                      */
/* ------------------------------------------------------------------------- */

int
main(void)
{
    /* Hook SIGINT/SIGTERM for graceful shutdown */
    struct sigaction sa = {
        .sa_handler = on_signal,
        .sa_flags   = 0,
    };
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT,  &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    /* Determine listen port */
    const char *port_env = getenv("EDUGATE_PORT");
    uint16_t listen_port = (uint16_t)(port_env ? atoi(port_env)
                                              : DEFAULT_LISTEN_PORT);

    char logbuf[128];
    snprintf(logbuf, sizeof(logbuf),
             "Starting EduGate ScholarLink (%s) on port %u",
             GATEWAY_VERSION, (unsigned int)listen_port);
    LOG_INFO(logbuf);

    /* Initialize HTTP daemon */
    struct MHD_Daemon *daemon = MHD_start_daemon(
        MHD_USE_SELECT_INTERNALLY   |
        MHD_USE_SIGNAL_PIPE         |
        MHD_USE_THREAD_PER_CONNECTION, /* simple but sufficient */
        listen_port,
        NULL, NULL,                 /* accept policy callback */
        &ahc_router_cb, NULL,       /* url handler */
        MHD_OPTION_CONNECTION_LIMIT, (unsigned int)DEFAULT_CONN_BACKLOG,
        MHD_OPTION_THREAD_POOL_SIZE, (unsigned int)DEFAULT_THREAD_POOL,
        MHD_OPTION_NOTIFY_COMPLETED, NULL, NULL, /* ignore */
        MHD_OPTION_END);

    if (!daemon) {
        LOG_ERROR("Failed to start HTTP daemon");
        return EXIT_FAILURE;
    }

    LOG_INFO("Gateway is up.  Press Ctrl+C to shut down.");

    /* Main loop: wait until signal changes g_stop_flag */
    while (!g_stop_flag) {
        sleep(1);
    }

    LOG_INFO("Shutdown requested, stopping HTTP daemon…");
    MHD_stop_daemon(daemon);

    LOG_INFO("Shutdown complete.");
    return EXIT_SUCCESS;
}