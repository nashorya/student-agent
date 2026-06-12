/*
 * EduGate ScholarLink - Router Component
 * --------------------------------------
 * This file implements the core routing engine for the EduGate ScholarLink
 * API-Gateway.  The router is responsible for mapping an inbound HTTP/GraphQL
 * request—including its path, HTTP method, and curriculum-year version tag—
 * to the correct upstream handler.
 *
 * Highlights
 * ----------
 *  • Thread-safe registration / lookup through an RW-lock
 *  • Lightweight, allocation-free fast-path for happy-case look-ups
 *  • Educational routing features (curriculum-year versions & pedagogic labels)
 *  • Path-parameter extraction ("/students/:id/courses/:cid")
 *  • Observability hooks (metrics + structured logging)
 *
 * NOTE: External component headers (logger, validator, metrics) purposefully
 *       appear as forward declarations; the implementation lives elsewhere in
 *       the codebase.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <ctype.h>
#include <errno.h>
#include <inttypes.h>

#include "router.h"
#include "logger.h"     /* edu_logger_*()                    */
#include "validator.h"  /* validator_validate_request()      */
#include "metrics.h"    /* metrics_counter_inc()             */


/* ────────────────────────────────────────────────────────────────────────── */
/*  Forward declarations for types owned by other components (thin stubs).   */
/* ────────────────────────────────────────────────────────────────────────── */
typedef struct eg_request_s  eg_request_t;
typedef struct eg_response_s eg_response_t;

/* Handler signature */
typedef int (*eg_route_handler_fn)(const eg_request_t *req,
                                   eg_response_t      *resp,
                                   void               *user_data);

/* ────────────────────────────────────────────────────────────────────────── */
/*  Router API datatypes                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

typedef enum {
    HTTP_GET     = 0,
    HTTP_POST    = 1,
    HTTP_PUT     = 2,
    HTTP_PATCH   = 3,
    HTTP_DELETE  = 4,
    HTTP_OPTIONS = 5,
    HTTP_ANY     = 6              /* wildcard convenience */
} eg_http_method_t;

typedef struct eg_route_s {
    char                 *path_pattern;   /* e.g. "/students/:id/courses"           */
    eg_http_method_t      method;         /* GET/POST/… or HTTP_ANY                */
    char                 *version_tag;    /* e.g. "v2024_Spring"                   */
    eg_route_handler_fn   handler;        /* upstream dispatch fn                  */
    void                 *handler_ctx;    /* user-data passed to handler           */
    char                 *pedagogic_lbl;  /* monitoring label ("Formative Assess") */
} eg_route_t;

typedef struct {
    eg_route_t  *items;      /* dynamic array of routes            */
    size_t       size;       /* number of routes actually stored   */
    size_t       capacity;   /* malloc()-ed capacity               */
    pthread_rwlock_t rwlock; /* readers-writers lock for thread-safety */
} eg_route_table_t;

/* Global singleton route table */
static eg_route_table_t g_route_table = {
    .items     = NULL,
    .size      = 0,
    .capacity  = 0
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Utility Prototypes                                                       */
/* ────────────────────────────────────────────────────────────────────────── */
static int  route_table_ensure_capacity(eg_route_table_t *tbl, size_t min_cap);
static int  path_pattern_match(const char *pattern, const char *path,
                               char ***out_keys, char ***out_vals, size_t *kv_len);
static int  path_tokenize(const char *path, char ***tokens_out, size_t *len_out);
static void free_tokens(char **tokens, size_t len);
static char *strdup_safe(const char *src);

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public API Implementation                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/*
 * eg_router_init()
 * Initialize global route table. Call once at boot.
 */
int eg_router_init(void)
{
    int rc = pthread_rwlock_init(&g_route_table.rwlock, NULL);
    if (rc != 0) {
        edu_logger_error("router", "Failed to init RWLock: %s", strerror(rc));
        return -1;
    }
    g_route_table.items    = NULL;
    g_route_table.size     = 0;
    g_route_table.capacity = 0;
    return 0;
}

/*
 * eg_router_shutdown()
 * Gracefully free all route definitions.
 */
void eg_router_shutdown(void)
{
    pthread_rwlock_wrlock(&g_route_table.rwlock);

    for (size_t i = 0; i < g_route_table.size; ++i) {
        eg_route_t *r = &g_route_table.items[i];
        free(r->path_pattern);
        free(r->version_tag);
        free(r->pedagogic_lbl);
        /* handler_ctx managed by caller */
    }
    free(g_route_table.items);
    g_route_table.items    = NULL;
    g_route_table.size     = 0;
    g_route_table.capacity = 0;

    pthread_rwlock_unlock(&g_route_table.rwlock);
    pthread_rwlock_destroy(&g_route_table.rwlock);
}

/*
 * eg_router_add_route()
 * Register a new route with the gateway.
 */
int eg_router_add_route(const char            *path_pattern,
                        eg_http_method_t       method,
                        const char            *version_tag,
                        const char            *pedagogic_lbl,
                        eg_route_handler_fn    handler,
                        void                  *handler_ctx)
{
    if (!path_pattern || !handler || !version_tag) {
        errno = EINVAL;
        return -1;
    }

    pthread_rwlock_wrlock(&g_route_table.rwlock);

    /* ensure capacity */
    if (route_table_ensure_capacity(&g_route_table, g_route_table.size + 1) < 0) {
        pthread_rwlock_unlock(&g_route_table.rwlock);
        return -1;
    }

    eg_route_t *r              = &g_route_table.items[g_route_table.size++];
    r->path_pattern            = strdup_safe(path_pattern);
    r->method                  = method;
    r->version_tag             = strdup_safe(version_tag);
    r->pedagogic_lbl           = pedagogic_lbl ? strdup_safe(pedagogic_lbl) : NULL;
    r->handler                 = handler;
    r->handler_ctx             = handler_ctx;

    edu_logger_info("router", "Added route %s %s (%s)", version_tag, path_pattern,
                    pedagogic_lbl ? pedagogic_lbl : "no-label");

    pthread_rwlock_unlock(&g_route_table.rwlock);
    return 0;
}

/*
 * eg_router_remove_route()
 * Unregister a route. A best-effort search is done on path+method+version.
 */
int eg_router_remove_route(const char *path_pattern,
                           eg_http_method_t method,
                           const char *version_tag)
{
    if (!path_pattern || !version_tag) {
        errno = EINVAL;
        return -1;
    }

    pthread_rwlock_wrlock(&g_route_table.rwlock);

    for (size_t i = 0; i < g_route_table.size; ++i) {
        eg_route_t *r = &g_route_table.items[i];
        if (r->method == method &&
            strcmp(r->version_tag, version_tag) == 0 &&
            strcmp(r->path_pattern, path_pattern) == 0) {

            /* free resources */
            free(r->path_pattern);
            free(r->version_tag);
            free(r->pedagogic_lbl);

            /* move tail elem to slot i */
            g_route_table.items[i] =
                g_route_table.items[g_route_table.size - 1];
            g_route_table.size--;

            edu_logger_info("router", "Removed route %s %s", version_tag, path_pattern);
            pthread_rwlock_unlock(&g_route_table.rwlock);
            return 0;
        }
    }

    pthread_rwlock_unlock(&g_route_table.rwlock);
    errno = ENOENT;
    return -1;
}


/*
 * eg_router_handle()
 * Main entry point invoked by the HTTP server layer.  Locates a route,
 * triggers validation, passes through to handler, records metrics.
 */
int eg_router_handle(const eg_request_t *req, eg_response_t *resp)
{
    if (!req || !resp) {
        errno = EINVAL;
        return -1;
    }

    /* 1. Resolve route */
    eg_route_t *matched = NULL;
    pthread_rwlock_rdlock(&g_route_table.rwlock);

    for (size_t i = 0; i < g_route_table.size; ++i) {
        eg_route_t *r = &g_route_table.items[i];

        /* Method must match or be wildcard */
        if (r->method != HTTP_ANY && r->method != req->method)
            continue;

        /* Match version */
        if (strcmp(r->version_tag, req->version_tag) != 0)
            continue;

        if (path_pattern_match(r->path_pattern, req->path,
                               NULL, NULL, NULL) == 1) {
            matched = r;
            break;
        }
    }

    if (!matched) {
        pthread_rwlock_unlock(&g_route_table.rwlock);
        edu_logger_warn("router", "No route for %s %s (v=%s)",
                        eg_http_method_str(req->method),
                        req->path,
                        req->version_tag);
        /* Compose 404 response (helper elsewhere) */
        resp->status = 404;
        strcpy(resp->body, "{\"error\":\"Route not found\"}");
        return 0;
    }

    /* 2. Validation (e.g., JSON schema) */
    if (validator_validate_request(req) != 0) {
        pthread_rwlock_unlock(&g_route_table.rwlock);
        resp->status = 400;
        strcpy(resp->body, "{\"error\":\"Validation failed\"}");
        return 0;
    }

    /* 3. Observability */
    metrics_counter_inc("router.requests_total", 1,
                        "method", eg_http_method_str(req->method),
                        "version", matched->version_tag,
                        "pedagogic_lbl", matched->pedagogic_lbl ? matched->pedagogic_lbl : "n/a",
                        NULL);

    /* Capture handler & ctx before releasing lock */
    eg_route_handler_fn handler      = matched->handler;
    void               *handler_ctx  = matched->handler_ctx;
    pthread_rwlock_unlock(&g_route_table.rwlock);

    /* 4. Dispatch */
    int rc = handler(req, resp, handler_ctx);

    /* 5. Record outcome */
    metrics_counter_inc("router.responses_total", 1,
                        "status", resp->status,
                        NULL);

    return rc;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Internal helpers                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/* route_table_ensure_capacity()
 * Grow the dynamic array to at least @min_cap.
 */
static int route_table_ensure_capacity(eg_route_table_t *tbl, size_t min_cap)
{
    if (tbl->capacity >= min_cap)
        return 0;

    size_t new_cap = tbl->capacity == 0 ? 8 : tbl->capacity * 2;
    while (new_cap < min_cap)
        new_cap *= 2;

    eg_route_t *new_items = realloc(tbl->items, new_cap * sizeof(*new_items));
    if (!new_items) {
        edu_logger_error("router", "Failed to realloc route table (%zu→%zu)",
                         tbl->capacity, new_cap);
        return -1;
    }
    tbl->items    = new_items;
    tbl->capacity = new_cap;
    return 0;
}

/* strdup_safe()
 * Like strdup() but with error handling.
 */
static char *strdup_safe(const char *src)
{
    char *dup = strdup(src);
    if (!dup) {
        edu_logger_error("router", "Out of memory while duplicating string");
        abort(); /* Unrecoverable in router configuration phase */
    }
    return dup;
}

/* path_pattern_match()
 * Very small foot-print path-matching that supports:
 *   • Static segments ("/students")
 *   • Parameter segments starting with ':' ("/students/:id")
 *   • Wildcard tail "**" ("/assets/**")
 *
 * Returns 1 on match, 0 on no-match, negative on error.
 *
 * NOTE: out_keys/out_vals capture extracted path parameters if caller wants
 *       them (may be NULL).  The function allocates memory for keys/values
 *       which must be freed via free_tokens().
 */
static int path_pattern_match(const char *pattern,
                              const char *path,
                              char ***out_keys,
                              char ***out_vals,
                              size_t *kv_len)
{
    char **pat_tok = NULL, **path_tok = NULL;
    size_t p_len = 0, t_len = 0;
    int match = 0;

    if (path_tokenize(pattern, &pat_tok, &p_len) < 0)
        goto cleanup;
    if (path_tokenize(path, &path_tok, &t_len) < 0)
        goto cleanup;

    size_t i = 0, j = 0;
    size_t kv_cap = 0;
    char **keys = NULL, **vals = NULL;
    size_t kv_idx = 0;

    for (; i < p_len && j < t_len; ++i, ++j)
    {
        if (strcmp(pat_tok[i], "**") == 0) {
            /* wildcard matches the rest */
            match = 1;
            goto success;
        }

        if (pat_tok[i][0] == ':') {
            /* parameter segment */
            if (out_keys && out_vals) {
                if (kv_idx >= kv_cap) {
                    kv_cap = kv_cap == 0 ? 4 : kv_cap * 2;
                    keys = realloc(keys, kv_cap * sizeof(char *));
                    vals = realloc(vals, kv_cap * sizeof(char *));
                    if (!keys || !vals) goto oom;
                }
                keys[kv_idx] = strdup_safe(pat_tok[i] + 1); /* skip ':' */
                vals[kv_idx] = strdup_safe(path_tok[j]);
                ++kv_idx;
            }
            continue;
        }

        /* static segment */
        if (strcmp(pat_tok[i], path_tok[j]) != 0)
            goto cleanup; /* no-match */
    }

    /* Trailing tokens in either pattern or path? */
    if (i == p_len && j == t_len) {
        match = 1;
    }

 success:
    if (match && out_keys && out_vals) {
        *out_keys = keys;
        *out_vals = vals;
        if (kv_len) *kv_len = kv_idx;
    } else {
        free_tokens(keys, kv_idx);
        free_tokens(vals, kv_idx);
    }

 cleanup:
    free_tokens(pat_tok, p_len);
    free_tokens(path_tok, t_len);
    return match;

 oom:
    free_tokens(keys, kv_idx);
    free_tokens(vals, kv_idx);
    free_tokens(pat_tok, p_len);
    free_tokens(path_tok, t_len);
    return -1;
}

/* path_tokenize()
 * Split a '/' separated path into NULL-terminated tokens.
 */
static int path_tokenize(const char *path, char ***tokens_out, size_t *len_out)
{
    size_t cap = 4, len = 0;
    char **tokens = malloc(cap * sizeof(char *));
    if (!tokens) return -1;

    const char *cur = path;
    while (*cur) {
        while (*cur == '/') cur++;          /* skip leading '/' */
        if (*cur == '\0') break;

        const char *start = cur;
        while (*cur != '/' && *cur != '\0') cur++;
        size_t seg_len = cur - start;
        char *seg = malloc(seg_len + 1);
        if (!seg) goto oom;
        memcpy(seg, start, seg_len);
        seg[seg_len] = '\0';

        if (len >= cap) {
            cap *= 2;
            char **tmp = realloc(tokens, cap * sizeof(char *));
            if (!tmp) goto oom;
            tokens = tmp;
        }
        tokens[len++] = seg;
    }

    *tokens_out = tokens;
    *len_out    = len;
    return 0;

 oom:
    for (size_t i = 0; i < len; ++i) free(tokens[i]);
    free(tokens);
    return -1;
}

/* free_tokens()
 * Utility to free array of malloc'ed strings.
 */
static void free_tokens(char **tokens, size_t len)
{
    if (!tokens) return;
    for (size_t i = 0; i < len; ++i)
        free(tokens[i]);
    free(tokens);
}

/* eg_http_method_str()
 * Convert enum to upper-case string (GET/POST/…).
 * Definition kept here (vs. public header) to avoid additional files.
 */
const char *eg_http_method_str(eg_http_method_t m)
{
    switch (m) {
        case HTTP_GET:     return "GET";
        case HTTP_POST:    return "POST";
        case HTTP_PUT:     return "PUT";
        case HTTP_PATCH:   return "PATCH";
        case HTTP_DELETE:  return "DELETE";
        case HTTP_OPTIONS: return "OPTIONS";
        case HTTP_ANY:     return "ANY";
        default:           return "UNK";
    }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  End of router.c                                                          */
/* ────────────────────────────────────────────────────────────────────────── */
