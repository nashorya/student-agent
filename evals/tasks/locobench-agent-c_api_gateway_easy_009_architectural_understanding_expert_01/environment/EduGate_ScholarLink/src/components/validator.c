/*
 *  EduGate ScholarLink - validator.c
 *
 *  Copyright (C) 2024  EduGate Contributors
 *
 *  Request-validation component for the EduGate ScholarLink API Gateway.
 *
 *  Responsibilities
 *  ----------------
 *   • Performs syntactic and semantic validation of incoming requests
 *     before they are routed to downstream micro-services.
 *   • Validates:
 *        – API version tag (curriculum-year semantics, e.g., v2024_Spring)
 *        – Required gateway headers (Auth, rate-limit tokens, content-type…)
 *        – HTTP method/path conformity with the gateway’s routing table
 *        – JSON payload size and schema compliance
 *        – GraphQL payload compliance against registry-stored schema
 *   • Emits validation metrics and structured diagnostics.
 *
 *  Thread-safety
 *  -------------
 *   The validator context is shared between worker threads and protected
 *   with a read/write lock.  Schema updates acquire the write lock while
 *   request validations acquire the read lock, enabling high concurrency.
 *
 *  Build notes
 *  -----------
 *   Requires linkage with:
 *      – pthread          (thread-safety primitives)
 *      – cJSON            (light-weight JSON parser)
 *   Internal EduGate dependencies (headers only):
 *      – validator.h
 *      – request.h
 *      – schema_registry.h
 *      – metrics.h
 *      – logger.h
 */

#include <ctype.h>
#include <limits.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

#include "components/validator.h"
#include "core/logger.h"
#include "core/metrics.h"
#include "core/request.h"
#include "core/schema_registry.h"

#define MAX_REPORT_MSG_LEN 256
#define MAX_PAYLOAD_SIZE   (1024 * 1024) /* 1 MiB soft limit */

typedef struct validator_ctx {
    schema_registry_t *registry;
    pthread_rwlock_t   lock;
} validator_ctx_t;

/* ──────────────────────────────  Helpers  ────────────────────────────── */

/* Validate academic version tag, e.g. `v2024_Spring`. */
static bool
is_valid_version_tag(const char *tag)
{
    if (!tag || tag[0] != 'v')
        return false;

    /* vYYYY_Season */
    if (strlen(tag) < 8) /* minimal: v0000_F */
        return false;

    /* Parse academic year. */
    int year = atoi(tag + 1);
    if (year < 2020 || year > 2100) /* arbitrary window */
        return false;

    /* Find underscore separator. */
    const char *season = strchr(tag, '_');
    if (!season || season == tag + 1)
        return false;

    /* Acceptable seasons. */
    season++; /* move past '_' */
    return (strcmp(season, "Spring") == 0) ||
           (strcmp(season, "Summer") == 0) ||
           (strcmp(season, "Fall")   == 0) ||
           (strcmp(season, "Winter") == 0);
}

/* Header value must be a positive integer <= 10 000 (requests per student) */
static bool
is_valid_throttle_header(const char *value)
{
    if (!value || !*value)
        return false;

    char *endptr = NULL;
    long  v      = strtol(value, &endptr, 10);

    return (*endptr == '\0') && (v > 0) && (v <= 10000);
}

/* Simple GraphQL sanity check – ensures 'query' or 'mutation' keyword. */
static bool
is_potentially_valid_graphql(const char *query)
{
    if (!query)
        return false;

    /* Skip leading whitespace/comments. */
    while (isspace((unsigned char)*query))
        query++;

    return (strncmp(query, "query",     5) == 0) ||
           (strncmp(query, "mutation",  8) == 0) ||
           (strncmp(query, "subscription", 12) == 0);
}

/* JSON payload size guard & structural validation */
static bool
validate_json_payload(const uint8_t *payload, size_t len,
                      const char    *schema_id,
                      validator_report_t *report,
                      schema_registry_t  *registry)
{
    if (len > MAX_PAYLOAD_SIZE) {
        snprintf(report->message, MAX_REPORT_MSG_LEN,
                 "Payload too large (%zu bytes > %d bytes).", len, MAX_PAYLOAD_SIZE);
        return false;
    }

    cJSON *root = cJSON_ParseWithLength((const char *)payload, (int)len);
    if (!root) {
        snprintf(report->message, MAX_REPORT_MSG_LEN,
                 "Malformed JSON payload: %s", cJSON_GetErrorPtr());
        return false;
    }

    /* Validate against optional JSON schema */
    if (schema_id && *schema_id) {
        const json_schema_t *schema = schema_registry_get_json_schema(registry, schema_id);
        if (!schema) {
            cJSON_Delete(root);
            snprintf(report->message, MAX_REPORT_MSG_LEN,
                     "Schema '%s' not found.", schema_id);
            return false;
        }

        char schema_error[128] = {0};
        bool ok = json_schema_validate(schema, root, schema_error, sizeof schema_error);
        if (!ok) {
            cJSON_Delete(root);
            snprintf(report->message, MAX_REPORT_MSG_LEN,
                     "Schema validation failed: %s", schema_error);
            return false;
        }
    }

    cJSON_Delete(root);
    return true;
}

/* ───────────────────────  Public API implementation  ─────────────────── */

validator_ctx_t *
validator_create(schema_registry_t *registry)
{
    if (!registry)
        return NULL;

    validator_ctx_t *ctx = calloc(1, sizeof *ctx);
    if (!ctx)
        return NULL;

    ctx->registry = registry;
    if (pthread_rwlock_init(&ctx->lock, NULL) != 0) {
        free(ctx);
        return NULL;
    }

    LOGGER_INFO("Validator context initialized.");
    return ctx;
}

void
validator_destroy(validator_ctx_t *ctx)
{
    if (!ctx)
        return;

    pthread_rwlock_destroy(&ctx->lock);
    free(ctx);

    LOGGER_INFO("Validator context destroyed.");
}

/*
 *  Core validation routine.
 *
 *  When report != NULL an explanatory diagnostic is provided
 *  if the function returns anything other than VALIDATOR_OK.
 */
validator_status_t
validator_validate(validator_ctx_t            *ctx,
                   const gateway_request_t    *req,
                   validator_report_t         *report)
{
    if (report)
        memset(report, 0, sizeof *report);

    if (!ctx || !req) {
        if (report)
            snprintf(report->message, MAX_REPORT_MSG_LEN, "Internal validator error.");
        return VALIDATOR_ERROR;
    }

    /* Read-lock for schema registry access */
    pthread_rwlock_rdlock(&ctx->lock);

    /* 1. Header checks */
    const char *auth = request_header_get(req, "Authorization");
    if (!auth) {
        if (report)
            snprintf(report->message, MAX_REPORT_MSG_LEN, "Missing Authorization header.");
        pthread_rwlock_unlock(&ctx->lock);
        return VALIDATOR_INVALID_HEADER;
    }

    const char *version = request_header_get(req, "X-Edu-Version");
    if (!is_valid_version_tag(version)) {
        if (report)
            snprintf(report->message, MAX_REPORT_MSG_LEN, "Invalid or missing version tag.");
        pthread_rwlock_unlock(&ctx->lock);
        return VALIDATOR_INVALID_HEADER;
    }

    const char *throttle = request_header_get(req, "X-Student-Quota");
    if (throttle && !is_valid_throttle_header(throttle)) {
        if (report)
            snprintf(report->message, MAX_REPORT_MSG_LEN,
                     "X-Student-Quota header must be integer 1-10000.");
        pthread_rwlock_unlock(&ctx->lock);
        return VALIDATOR_INVALID_HEADER;
    }

    /* 2. Method/Path validation (consult routing table from schema registry). */
    const route_schema_t *route =
        schema_registry_match_route(ctx->registry, req->method, req->path);

    if (!route) {
        if (report)
            snprintf(report->message, MAX_REPORT_MSG_LEN, "Route not found.");
        pthread_rwlock_unlock(&ctx->lock);
        return VALIDATOR_INVALID_PATH;
    }

    /* 3. Payload validation based on route type. */
    bool payload_ok = true;
    if (req->payload && req->payload_len > 0) {
        if (route->type == ROUTE_REST_JSON) {
            payload_ok =
                validate_json_payload(req->payload,
                                      req->payload_len,
                                      route->json_schema_id,
                                      report,
                                      ctx->registry);
        } else if (route->type == ROUTE_GRAPHQL) {
            /* For GraphQL we let graphql_parser do the heavy lifting later;
               we just ensure the query looks plausible & obeys size limit. */
            if (req->payload_len > MAX_PAYLOAD_SIZE) {
                snprintf(report->message, MAX_REPORT_MSG_LEN,
                         "GraphQL payload too large.");
                payload_ok = false;
            } else {
                char *query = strndup((const char *)req->payload,
                                      req->payload_len);
                if (!query || !is_potentially_valid_graphql(query)) {
                    snprintf(report->message, MAX_REPORT_MSG_LEN,
                             "Malformed GraphQL query.");
                    payload_ok = false;
                }
                free(query);
            }
        }
    } else if (route->requires_body) {
        snprintf(report->message, MAX_REPORT_MSG_LEN,
                 "Request body required for this endpoint.");
        payload_ok = false;
    }

    pthread_rwlock_unlock(&ctx->lock);

    if (!payload_ok)
        return VALIDATOR_INVALID_PAYLOAD;

    /* ── Record metrics */
    metrics_counter_inc(METRIC_REQUEST_VALIDATION_OK);

    return VALIDATOR_OK;
}

/* ────────────────────────  Hot-reload entry point  ────────────────────── */

/*
 *  Re-load schemas at runtime (e.g., on file-watch notification).
 *  The function acquires the write lock to ensure no validations
 *  are running concurrently while the registry is refreshed.
 */
bool
validator_reload_schemas(validator_ctx_t *ctx)
{
    if (!ctx)
        return false;

    pthread_rwlock_wrlock(&ctx->lock);
    bool ok = schema_registry_reload(ctx->registry);
    pthread_rwlock_unlock(&ctx->lock);

    if (ok)
        LOGGER_INFO("Validator reloaded schemas successfully.");
    else
        LOGGER_ERROR("Validator failed to reload schemas.");

    return ok;
}
