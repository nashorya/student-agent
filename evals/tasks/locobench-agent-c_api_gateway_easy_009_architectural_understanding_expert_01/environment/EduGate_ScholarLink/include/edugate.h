/**
 * ============================================================================
 * EduGate ScholarLink — Public API
 * ============================================================================
 * Copyright (c) 2024
 * ----------------------------------------------------------------------------
 *  File      : edugate.h
 *  Brief     : Core public structures and functions for the EduGate
 *              API-gateway runtime.  All components—router, validator,
 *              GraphQL engine, metrics—plug into the EgCore context that
 *              lives for the lifetime of the gateway process.
 *
 *  NOTE:      This header purposefully exposes only the abstractions required
 *             by module implementers or host applications.  Internal details
 *             are hidden to preserve binary compatibility between versions.
 * ----------------------------------------------------------------------------
 *  License   : MIT
 * ============================================================================
 */

#ifndef EDUGATE_INCLUDE_EDUGATE_H
#define EDUGATE_INCLUDE_EDUGATE_H

/* ---------------------------------------------------------------------------
 *  Standard headers
 * ------------------------------------------------------------------------- */
#include <stddef.h>   /* size_t   */
#include <stdint.h>   /* uint32_t */
#include <stdbool.h>  /* bool     */

#ifdef __cplusplus
extern "C" {
#endif

/* ---------------------------------------------------------------------------
 *  Build-time version identifiers
 * ------------------------------------------------------------------------- */
#define EDUGATE_VERSION_MAJOR    0
#define EDUGATE_VERSION_MINOR    9
#define EDUGATE_VERSION_PATCH    2
#define EDUGATE_VERSION_STRING   "0.9.2"

/* clang-style non-null attribute (ignored by other compilers) */
#if defined(__clang__) || defined(__GNUC__)
#  define EDG_NONNULL(...) __attribute__((nonnull(__VA_ARGS__)))
#else
#  define EDG_NONNULL(...)
#endif

/* ---------------------------------------------------------------------------
 *  Forward declarations
 * ------------------------------------------------------------------------- */
struct EgCore;             /* Opaque gateway runtime  */
struct EgRequest;          /* Immutable HTTP request  */
struct EgResponse;         /* Mutable HTTP response   */
struct EgGraphQLSchema;    /* GraphQL schema object   */
struct EgMetricsSnapshot;  /* Collected metrics data  */

/* ---------------------------------------------------------------------------
 *  Fixed-size string slice (utf-8, non-null-terminated)
 * ------------------------------------------------------------------------- */
typedef struct EgSlice {
    const char *ptr;  /* Pointer to first byte               */
    size_t      len;  /* Number of bytes in slice (utf-8 OK) */
} EgSlice;

/* Helper macro for literal slice construction */
#define EG_SLICE_LIT(s)  ((EgSlice){ (s), sizeof(s) - 1 })

/* ---------------------------------------------------------------------------
 *  HTTP method set
 * ------------------------------------------------------------------------- */
typedef enum EgHttpMethod {
    EG_HTTP_GET,
    EG_HTTP_POST,
    EG_HTTP_PUT,
    EG_HTTP_PATCH,
    EG_HTTP_DELETE,
    EG_HTTP_OPTIONS,
    EG_HTTP_HEAD,
    EG_HTTP_METHOD_INVALID
} EgHttpMethod;

/* ---------------------------------------------------------------------------
 *  Error / status codes (positive == success/warning, negative == fatal)
 * ------------------------------------------------------------------------- */
typedef enum EgStatus {
    EG_OK                             = 0,     /* Generic success           */

    /* Recoverable/user errors (negative but presentable to clients) */
    EG_ERR_BAD_REQUEST                = -10,
    EG_ERR_UNAUTHORIZED               = -11,
    EG_ERR_FORBIDDEN                  = -12,
    EG_ERR_NOT_FOUND                  = -13,
    EG_ERR_METHOD_NOT_ALLOWED         = -14,
    EG_ERR_REQUEST_TOO_LARGE          = -15,

    /* Gateway internal errors (negative, server-side) */
    EG_ERR_INTERNAL                   = -100,
    EG_ERR_NO_MEMORY                  = -101,
    EG_ERR_INVALID_STATE              = -102,
    EG_ERR_SCHEMA_VALIDATION          = -103,
    EG_ERR_PLUGIN_FAILURE             = -104,
    EG_ERR_IO                         = -105,
    EG_ERR_TIMEOUT                    = -106,

    /* Warnings / non-fatal statuses (positive) */
    EG_WARN_PARTIAL_CONTENT           =  42,
    EG_WARN_DEPRECATED_API            =  43

} EgStatus;

/* ---------------------------------------------------------------------------
 *  Route handler types
 * ------------------------------------------------------------------------- */

/* Immutable view of an HTTP request                                                                  
 * -------------------------------------------------------------------------
 *  path          : decoded URL path (e.g. "/courses/CS101")                                            
 *  query         : raw query string portion (without '?')                                              
 *  body          : request payload (slice, may be empty)                                               
 *  metadata      : reserved for future protocol features (e.g. peer addr)                             
 */
typedef struct EgRequest {
    EgHttpMethod method;
    EgSlice      path;
    EgSlice      query;
    EgSlice      body;
    void        *metadata;     /* opaque, defined by transport impl. */
} EgRequest;

/* Mutable HTTP response object returned to caller                                                      
 * -------------------------------------------------------------------------
 *  status_code : HTTP status to emit                                                                  
 *  body        : response payload (optional)                                                          
 *  headers     : user-supplied headers (CRLF separated "Key: Value" list)                             
 */
typedef struct EgResponse {
    uint16_t     status_code;
    EgSlice      body;
    const char  *headers;   /* CRLF separated header block, may be NULL */
    void        *impl;      /* gateway-internal details (opaque)        */
} EgResponse;

/* Type of user callback invoked when an HTTP route matches */
typedef EgStatus (*EgRouteHandler)(
        const EgRequest  *req,
        EgResponse       *resp,
        void             *user_ctx);

/* ---------------------------------------------------------------------------
 *  Validation plug-ins
 * ------------------------------------------------------------------------- */

/* Validator callback that inspects an HTTP request before it is routed.
 * Should return EG_OK or a suitable error; may write an error response.   */
typedef EgStatus (*EgValidatorFn)(
        const EgRequest  *req,
        EgResponse       *resp,
        void             *plugin_ctx);

/* ---------------------------------------------------------------------------
 *  GraphQL schema hot-swap interface
 * ------------------------------------------------------------------------- */

/* Opaque GraphQL schema type returned by parser/loader */
typedef struct EgGraphQLSchema EgGraphQLSchema;

/* ---------------------------------------------------------------------------
 *  Route registration descriptor
 * ------------------------------------------------------------------------- */
typedef struct EgRoute {
    EgHttpMethod    method;        /* GET, POST, ...                      */
    EgSlice         path_pattern;  /* e.g. "/v1/students/{id}"            */
    EgRouteHandler  handler;       /* user callback                       */
    void           *user_ctx;      /* user data passed back to handler    */
    const char     *docstring;     /* for live API docs dashboard         */
} EgRoute;

/* ---------------------------------------------------------------------------
 *  Gateway configuration structure
 * ------------------------------------------------------------------------- */
typedef struct EgConfig {
    uint16_t    http_port;         /* 0 => choose random available port   */
    uint32_t    max_concurrent;    /* hard connection cap (0 = unlimited) */
    bool        enable_metrics;    /* export Prometheus /metrics endpoint */
    bool        enable_grpc;       /* enable HTTP/2 & gRPC proxy features */
    const char *log_file;          /* path to rolling log, NULL=>stderr   */
    void       *user_ctx;          /* for host application use            */
} EgConfig;

/* ---------------------------------------------------------------------------
 *  Public Gateway Lifecycle
 * ------------------------------------------------------------------------- */

/**
 * eg_startup
 * -------------------------------------------------------------------------
 * Initialize the EduGate core runtime and all opted-in subsystems.
 * The caller receives an opaque handle that must later be shut down
 * via eg_shutdown().
 *
 * Returns EG_OK on success or a negative EgStatus on failure.
 */
EgStatus
eg_startup(struct EgCore **out_core,
           const EgConfig *cfg)
           EDG_NONNULL(1,2);

/**
 * eg_shutdown
 * -------------------------------------------------------------------------
 * Dispose of all resources owned by the gateway instance.  Any routes or
 * plug-ins registered earlier become invalid after this call returns.
 */
void
eg_shutdown(struct EgCore *core);

/* ---------------------------------------------------------------------------
 *  Registration APIs
 * ------------------------------------------------------------------------- */

/* Add a new REST route; pattern syntax is the familiar URI-template format:
 *   /courses/{id}
 * Variables can later be extracted via helper functions in route handler.
 */
EgStatus
eg_register_route(struct EgCore   *core,
                  const EgRoute   *route_desc)
                  EDG_NONNULL(1,2);

/* Install a request validator that runs before routing. Multiple validators
 * execute in the order of registration until one returns an error.          */
EgStatus
eg_register_validator(struct EgCore  *core,
                      EgValidatorFn   fn,
                      void           *plugin_ctx)
                      EDG_NONNULL(1,2);

/* Replace the active GraphQL schema. Parsing and validation occur inside
 * this call; on success the new schema goes live atomically.                */
EgStatus
eg_set_graphql_schema(struct EgCore       *core,
                      const char          *schema_sdl,
                      size_t               sdl_len,
                      char               *errbuf,       /* optional */
                      size_t               errbuf_cap)   /* 0 => ignore */
                      EDG_NONNULL(1,2);

/* ---------------------------------------------------------------------------
 *  Metrics & Monitoring
 * ------------------------------------------------------------------------- */

/* Snapshot gateway metrics into a caller-supplied structure. The snapshot
 * is a deep copy and can be safely used after returning.                    */
EgStatus
eg_collect_metrics(struct EgCore          *core,
                   struct EgMetricsSnapshot *out_snapshot)
                   EDG_NONNULL(1,2);

/* Human-readable representation of EgStatus suitable for logs/UI. */
const char*
eg_status_str(EgStatus s);

/* ---------------------------------------------------------------------------
 *  Miscellaneous helpers
 * ------------------------------------------------------------------------- */

/* Parse the path variables from a request that matched the given pattern.
 * On success, `vars_out` receives an array of EgSlice pairs (name,value).   
 * The caller owns neither memory; slices reference data inside `req`.       *
 * Returns number of vars or negative EgStatus on error.                     */
int
eg_extract_path_vars(const EgRequest *req,
                     EgSlice          pattern,
                     EgSlice         *vars_out,
                     size_t           max_vars)
                     EDG_NONNULL(1);

/* Convert method enum to string literal (e.g., GET). */
const char*
eg_method_str(EgHttpMethod m);

/* ---------------------------------------------------------------------------
 *  Concurrency notes
 * ---------------------------------------------------------------------------
 *  All registration APIs (`eg_register_*`, `eg_set_graphql_schema`, …) are
 *  NOT thread-safe and must be invoked before calling eg_start_listening()
 *  (defined in the transport layer) or while the gateway is in maintenance
 *  mode.  Request-time APIs (`EgRouteHandler`, `eg_extract_path_vars`, …)
 *  are re-entrant; handlers may run concurrently across worker threads.
 * ------------------------------------------------------------------------- */

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* EDUGATE_INCLUDE_EDUGATE_H */
