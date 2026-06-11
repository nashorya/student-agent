/**
 * EduGate ScholarLink - Monitoring Component
 *
 * File:    src/components/monitoring.c
 * Author:  EduGate Core Team
 * License: MIT
 *
 * Description:
 *   A lightweight, thread-safe monitoring subsystem that is able to collect
 *   per-endpoint request metrics and expose them in either Prometheus text
 *   format or pretty-printed JSON.  The component is intentionally compact
 *   (single-file / no external dependencies except POSIX & uthash) to keep
 *   the pedagogic footprint low while remaining production-grade for small
 *   to mid-sized API-gateway workloads.
 *
 *   Metrics captured:
 *     • Total requests
 *     • Success (2xx), client error (4xx), server error (5xx) breakdown
 *     • Min/Max/Total latency (ms) for computing avg/stdev offline
 *
 *   Thread Safety:
 *     A single pthread mutex protects the internal metric hash-table.  Given
 *     the short critical sections (hash lookup & basic arithmetic) this is
 *     usually sufficient.  If very high cardinality or performance is
 *     required, the structure can be sharded or replaced with lock-free
 *     atomics—but this is beyond the scope of the educational code-base.
 *
 *   External API (public header is implied):
 *     int   monitoring_init     (void);
 *     void  monitoring_shutdown(void);
 *     void  monitoring_record_request(const char *endpoint,
 *                                     int          http_status,
 *                                     double       latency_ms);
 *     char *monitoring_export_prometheus(void);   // char* → free() by caller
 *     char *monitoring_export_json(void);         // char* → free() by caller
 */

#define _GNU_SOURCE /* asprintf */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <errno.h>
#include <time.h>
#include <stdbool.h>

/* =========================================================================
 * uthash (single-file hash-table implementation, BSD-licensed)
 * Only a trimmed subset of the original header is embedded to avoid
 * additional include-paths in the starter project; full version at:
 *      https://troydhanson.github.io/uthash/
 * ========================================================================= */
#ifndef UTHASH_H
#define UTHASH_H
#define uthash_fatal(msg) exit(-1)
#define uthash_malloc(sz) malloc(sz)
#define uthash_free(ptr,sz) free(ptr)
#define HASH_FIND_STR(head,findstr,out)                                          \
    HASH_FIND(hh, head, findstr, (unsigned)strlen(findstr), out)
#define HASH_ADD_STR(head,strfield,add)                                          \
    HASH_ADD(hh, head, strfield[0], (unsigned)strlen(add->strfield), add)
#define HASH_DEL(head,delptr)                                                    \
    HASH_DELETE(hh, head, delptr)
/* The rest of uthash macros. For brevity, only minimal subset */
#define HASH_FUNCTION(key,keylen,hashv)                                          \
do {                                                                             \
    unsigned _hf_i, _hf_hashv=0;                                                 \
    const unsigned char *_hf_key=(const unsigned char*)(key);                    \
    for(_hf_i=0; _hf_i<keylen; _hf_i++)                                          \
        _hf_hashv = _hf_hashv*33 + _hf_key[_hf_i];                               \
    hashv = _hf_hashv;                                                           \
} while(0)

#define HASH_FIND(hh,head,keyptr,keylen,out)                                     \
do {                                                                             \
    unsigned _hf_hashv;                                                          \
    out=NULL;                                                                    \
    if (head) {                                                                  \
        HASH_FUNCTION(keyptr, keylen, _hf_hashv);                                \
        out=(head);                                                              \
        while(out) {                                                             \
            if (out->keylen == keylen &&                                         \
                memcmp(out->key, keyptr, keylen)==0) break;                      \
            out = out->hh.next;                                                  \
        }                                                                        \
    }                                                                            \
} while(0)

#define HASH_ADD(hh,head,keyfield,keylen_in,add)                                 \
do {                                                                             \
    unsigned _ha_hashv;                                                          \
    HASH_FUNCTION(&add->keyfield, keylen_in, _ha_hashv);                         \
    add->key = (void*)&add->keyfield;                                            \
    add->keylen = keylen_in;                                                     \
    add->hh.hashv = _ha_hashv;                                                   \
    add->hh.next = head;                                                         \
    if (head) head->hh.prev = add;                                               \
    add->hh.prev = NULL;                                                         \
    head = add;                                                                  \
} while(0)

#define HASH_DELETE(hh,head,delptr)                                              \
do {                                                                             \
    if (delptr->hh.prev) delptr->hh.prev->hh.next = delptr->hh.next;             \
    else                head = delptr->hh.next;                                  \
    if (delptr->hh.next) delptr->hh.next->hh.prev = delptr->hh.prev;             \
} while(0)

typedef struct UT_hash_handle {
    struct UT_hash_table *tbl;
    void *prev;                   /* previous element in app order      */
    void *next;                   /* next element in app order          */
    struct UT_hash_handle *hh_prev; /* previous element in hh order     */
    struct UT_hash_handle *hh_next; /* next element in hh order         */
    const void *key; unsigned keylen;
    unsigned hashv;
} UT_hash_handle;

#endif /* UTHASH_H */
/* ===================  End uthash subset  ================================= */

#define EDU_METRIC_ENDPOINT_MAX 128

/* -------------------------------------------------------------------------
 * Data structures
 * ------------------------------------------------------------------------- */
typedef struct request_metric {
    char endpoint[EDU_METRIC_ENDPOINT_MAX]; /* key                     */
    /* Counters */
    unsigned long total;
    unsigned long success_2xx;
    unsigned long client_4xx;
    unsigned long server_5xx;

    /* Latency stats */
    double total_latency_ms;    /* sum   */
    double min_latency_ms;      /* track */
    double max_latency_ms;      /* track */

    /* uthash handle / meta */
    const void      *key;       /* internal */
    unsigned         keylen;    /* internal */
    UT_hash_handle   hh;        /* internal */
} request_metric_t;

/* -------------------------------------------------------------------------
 * Module state
 * ------------------------------------------------------------------------- */
static request_metric_t *g_metric_map = NULL;
static pthread_mutex_t   g_metric_lock = PTHREAD_MUTEX_INITIALIZER;
static bool              g_initialized = false;

/* -------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------- */

/* Return timestamp in ISO-8601 / RFC-3339 (UTC) */
static void fmt_timestamp_utc(char buf[32])
{
    time_t now = time(NULL);
    struct tm tm_utc;
    gmtime_r(&now, &tm_utc);
    strftime(buf, 32, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

static void safe_free(void *p)
{
    if (p) free(p);
}

/* -------------------------------------------------------------------------
 * Public API implementation
 * ------------------------------------------------------------------------- */
int monitoring_init(void)
{
    int rc = pthread_mutex_lock(&g_metric_lock);
    if (rc != 0) {
        fprintf(stderr, "[monitoring] mutex lock failed: %s\n", strerror(rc));
        return -1;
    }

    if (!g_initialized) {
        g_metric_map = NULL; /* fresh start, nothing to do */
        g_initialized = true;
    }

    pthread_mutex_unlock(&g_metric_lock);
    return 0;
}

void monitoring_shutdown(void)
{
    pthread_mutex_lock(&g_metric_lock);

    request_metric_t *it, *tmp;
    HASH_ITER(hh, g_metric_map, it, tmp) {
        HASH_DEL(g_metric_map, it);
        free(it);
    }
    g_initialized = false;
    pthread_mutex_unlock(&g_metric_lock);
}

/**
 * monitoring_record_request
 *
 * Thread-safe function for recording a finished HTTP request.
 *
 * @param endpoint     Canonical endpoint label (e.g., "/v1/quiz").
 * @param http_status  Standard 3-digit status code.
 * @param latency_ms   Time to complete request in milliseconds.
 */
void monitoring_record_request(const char *endpoint,
                               int          http_status,
                               double       latency_ms)
{
    if (!g_initialized || !endpoint) return;

    /* Clamp latency_ms to positive range */
    if (latency_ms < 0) latency_ms = 0;

    pthread_mutex_lock(&g_metric_lock);

    request_metric_t *metric = NULL;
    HASH_FIND_STR(g_metric_map, endpoint, metric);

    if (!metric) {
        metric = calloc(1, sizeof(request_metric_t));
        if (!metric) {
            pthread_mutex_unlock(&g_metric_lock);
            fprintf(stderr,
                    "[monitoring] Out of memory allocating metric for '%s'\n",
                    endpoint);
            return;
        }
        /* Initialize */
        strncpy(metric->endpoint, endpoint, sizeof(metric->endpoint) - 1);
        metric->min_latency_ms = latency_ms; /* first sample */
        HASH_ADD_STR(g_metric_map, endpoint, metric);
    }

    /* Update counters */
    metric->total++;
    if (http_status >= 200 && http_status < 300) metric->success_2xx++;
    else if (http_status >= 400 && http_status < 500) metric->client_4xx++;
    else if (http_status >= 500 && http_status < 600) metric->server_5xx++;

    /* Update latency stats */
    metric->total_latency_ms += latency_ms;
    if (latency_ms < metric->min_latency_ms) metric->min_latency_ms = latency_ms;
    if (latency_ms > metric->max_latency_ms) metric->max_latency_ms = latency_ms;

    pthread_mutex_unlock(&g_metric_lock);
}

/* -------------------------------------------------------------------------
 * Export helpers (common)
 * ------------------------------------------------------------------------- */

static double computed_avg_latency(const request_metric_t *m)
{
    return (m->total == 0) ? 0.0 : (m->total_latency_ms / (double)m->total);
}

/* -------------------------------------------------------------------------
 * Export: Prometheus
 * ------------------------------------------------------------------------- */

/**
 * monitoring_export_prometheus
 *
 * Return a dynamically allocated char* in Prometheus exposition format.
 * The caller must free() it after use.
 */
char *monitoring_export_prometheus(void)
{
    if (!g_initialized) return NULL;

    pthread_mutex_lock(&g_metric_lock);

    /* Reserve an initial buffer */
    size_t  buf_sz  = 4096;
    char   *buffer  = malloc(buf_sz);
    size_t  offset  = 0;

    if (!buffer) {
        pthread_mutex_unlock(&g_metric_lock);
        return NULL;
    }

    /* Helper macro to append formatted strings with auto-grow */
#define APPEND(fmt, ...)                                                         \
    do {                                                                         \
        int needed = snprintf(NULL, 0, fmt, __VA_ARGS__);                        \
        if (offset + needed + 2 > buf_sz) {                                      \
            buf_sz = (buf_sz + needed + 2) * 2;                                  \
            char *tmp = realloc(buffer, buf_sz);                                 \
            if (!tmp) { safe_free(buffer); pthread_mutex_unlock(&g_metric_lock); \
                         return NULL; }                                          \
            buffer = tmp;                                                        \
        }                                                                        \
        offset += sprintf(buffer + offset, fmt, __VA_ARGS__);                    \
    } while(0)

    /* Static metric descriptors */
    APPEND("# HELP edugate_requests_total Total HTTP requests received.\n");
    APPEND("# TYPE edugate_requests_total counter\n");
    APPEND("# HELP edugate_request_latency_ms Request latency in milliseconds (summary).\n");
    APPEND("# TYPE edugate_request_latency_ms summary\n");

    /* Iterate metrics */
    request_metric_t *it;
    for (it = g_metric_map; it; it = it->hh.next) {
        /* Counter samples */
        APPEND("edugate_requests_total{endpoint=\"%s\",code=\"2xx\"} %lu\n",
               it->endpoint, it->success_2xx);
        APPEND("edugate_requests_total{endpoint=\"%s\",code=\"4xx\"} %lu\n",
               it->endpoint, it->client_4xx);
        APPEND("edugate_requests_total{endpoint=\"%s\",code=\"5xx\"} %lu\n",
               it->endpoint, it->server_5xx);

        /* Latency summary: sum + count for Prometheus to compute quantiles */
        APPEND("edugate_request_latency_ms_sum{endpoint=\"%s\"} %.3f\n",
               it->endpoint, it->total_latency_ms);
        APPEND("edugate_request_latency_ms_count{endpoint=\"%s\"} %lu\n",
               it->endpoint, it->total);
    }

#undef APPEND

    pthread_mutex_unlock(&g_metric_lock);
    return buffer; /* caller takes ownership */
}

/* -------------------------------------------------------------------------
 * Export: JSON
 * ------------------------------------------------------------------------- */

/**
 * monitoring_export_json
 *
 * Pretty-prints metrics in JSON format for quick debugging / dashboarding.
 * The caller must free() the returned buffer.
 *
 * Example snippet:
 *   {
 *     "generated_at": "2024-05-25T14:12:33Z",
 *     "endpoints": [
 *       {
 *         "path": "/v1/quiz",
 *         "total": 122,
 *         "success_2xx": 118,
 *         "client_4xx": 3,
 *         "server_5xx": 1,
 *         "latency_ms": { "avg": 24.512, "min": 20.18, "max": 40.91 }
 *       }
 *     ]
 *   }
 */
char *monitoring_export_json(void)
{
    if (!g_initialized) return NULL;

    pthread_mutex_lock(&g_metric_lock);

    size_t buf_sz = 4096;
    char  *buffer = malloc(buf_sz);
    size_t offset = 0;
    if (!buffer) {
        pthread_mutex_unlock(&g_metric_lock);
        return NULL;
    }

#define APPEND_JSON(fmt, ...)                                                    \
    do {                                                                         \
        int needed = snprintf(NULL, 0, fmt, __VA_ARGS__);                        \
        if (offset + needed + 2 > buf_sz) {                                      \
            buf_sz = (buf_sz + needed + 2) * 2;                                  \
            char *tmp = realloc(buffer, buf_sz);                                 \
            if (!tmp) { safe_free(buffer); pthread_mutex_unlock(&g_metric_lock); \
                         return NULL; }                                          \
            buffer = tmp;                                                        \
        }                                                                        \
        offset += sprintf(buffer + offset, fmt, __VA_ARGS__);                    \
    } while(0)

    char ts[32]; fmt_timestamp_utc(ts);

    APPEND_JSON("{\n  \"generated_at\": \"%s\",\n  \"endpoints\": [\n", ts);

    request_metric_t *it;
    bool first = true;
    for (it = g_metric_map; it; it = it->hh.next) {
        if (!first) APPEND_JSON(",\n");
        first = false;

        APPEND_JSON("    {\n");
        APPEND_JSON("      \"path\": \"%s\",\n", it->endpoint);
        APPEND_JSON("      \"total\": %lu,\n", it->total);
        APPEND_JSON("      \"success_2xx\": %lu,\n", it->success_2xx);
        APPEND_JSON("      \"client_4xx\": %lu,\n", it->client_4xx);
        APPEND_JSON("      \"server_5xx\": %lu,\n", it->server_5xx);
        APPEND_JSON("      \"latency_ms\": {\n");
        APPEND_JSON("        \"avg\": %.3f,\n", computed_avg_latency(it));
        APPEND_JSON("        \"min\": %.3f,\n", it->min_latency_ms);
        APPEND_JSON("        \"max\": %.3f\n", it->max_latency_ms);
        APPEND_JSON("      }\n");
        APPEND_JSON("    }");
    }
    APPEND_JSON("\n  ]\n}\n");

#undef APPEND_JSON

    pthread_mutex_unlock(&g_metric_lock);
    return buffer; /* caller frees */
}

/* -------------------------------------------------------------------------
 * Unit-like smoke test (compiled only when building this file standalone)
 * ------------------------------------------------------------------------- */
#ifdef EDU_MONITORING_STANDALONE_TEST
int main(void)
{
    if (monitoring_init() != 0) {
        fprintf(stderr, "Init failed\n");
        return EXIT_FAILURE;
    }

    monitoring_record_request("/v1/quiz", 200, 23.2);
    monitoring_record_request("/v1/quiz", 200, 28.7);
    monitoring_record_request("/v1/quiz", 404, 8.1);
    monitoring_record_request("/v1/assignments", 503, 120.4);

    char *p = monitoring_export_prometheus();
    puts(p);
    free(p);

    char *j = monitoring_export_json();
    puts(j);
    free(j);

    monitoring_shutdown();
    return EXIT_SUCCESS;
}
#endif /* EDU_MONITORING_STANDALONE_TEST */

/* End of monitoring.c */
