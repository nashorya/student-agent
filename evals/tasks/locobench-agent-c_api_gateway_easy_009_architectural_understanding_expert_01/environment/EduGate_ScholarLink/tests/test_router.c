/********************************************************************************
 * SPDX-License-Identifier: MIT
 *
 * EduGate ScholarLink – Router Component Tests
 *
 * This file contains a set of unit-tests that exercise the public surface of the
 * router component.  The tests rely on the cmocka framework, which the build
 * system is expected to provide (e.g., via pkg-config “cmocka”).
 *
 * Tested feature matrix
 * ┌───────────────────────────┬────────────────────────────────────────────────┐
 * │ ROUTER CAPABILITY         │  TEST-CASE                                    │
 * ├───────────────────────────┼────────────────────────────────────────────────┤
 * │ Route registration        │ test_register_and_lookup_route                │
 * │ Basic dispatch            │ test_basic_route_dispatch                     │
 * │ 404 handling              │ test_dispatch_unknown_route                   │
 * │ Version selection logic   │ test_versioned_route_dispatch                 │
 * │ Throttling integration    │ test_throttled_route                          │
 * └───────────────────────────┴────────────────────────────────────────────────┘
 *
 * IMPORTANT:  These tests purposefully avoid any I/O, network, or cryptographic
 * primitives so that they can run in continuous-integration sandboxes that have
 * limited permissions.
 *******************************************************************************/

#include <stdarg.h>
#include <stddef.h>
#include <setjmp.h>
#include <cmocka.h>

#include "../src/router/router.h"        /* Public router interface            */
#include "../src/throttling/throttle.h"  /* Rate-limit policy interface        */

/* ---------------------------------------------------------------------------
 * Helpers / Test Fixtures
 * ------------------------------------------------------------------------- */

/* Stubbed response buffer (big enough for the tests). */
#define RESP_BUF_SZ 256

typedef struct
{
    router_t    *router;
    char         resp_buf[RESP_BUF_SZ];
} test_ctx_t;

/* A simple JSON “ping” handler. */
static int
ping_handler(const request_t *req,
             response_t      *res,
             void            *user_data)
{
    (void) req;
    (void) user_data;

    static const char pong[] = "{ \"pong\": true }";
    res->status_code = 200;
    res->body        = (char *)pong;
    res->body_len    = sizeof(pong) - 1;

    return ROUTER_OK;
}

/* A toy handler that always increments a counter stored in “user_data”. */
static int
counter_handler(const request_t *req,
                response_t      *res,
                void            *user_data)
{
    (void) req;

    uint32_t *cnt = (uint32_t *)user_data;
    ++(*cnt);

    res->status_code = 204;          /* No Content */
    res->body        = NULL;
    res->body_len    = 0;

    return ROUTER_OK;
}

/* Fault-injection handler used to verify error propagation. */
static int
error_handler(const request_t *req,
              response_t      *res,
              void            *user_data)
{
    (void) req;
    (void) res;
    (void) user_data;

    return ROUTER_ERR_INTERNAL;
}

/* Allocated before each test-case and freed afterwards. */
static int
setup(void **state)
{
    test_ctx_t *ctx = (test_ctx_t *)calloc(1, sizeof(*ctx));
    assert_non_null(ctx);

    int rc = router_create(&ctx->router);
    assert_int_equal(rc, ROUTER_OK);
    assert_non_null(ctx->router);

    *state = ctx;
    return 0;
}

static int
teardown(void **state)
{
    test_ctx_t *ctx = (test_ctx_t *)(*state);
    router_destroy(ctx->router);
    free(ctx);
    return 0;
}

/* Convenience wrapper that builds a request object. */
static void
make_request(request_t      *req,
             const char     *method,
             const char     *path,
             const char     *tenant,
             uint32_t        student_count)
{
    memset(req, 0, sizeof(*req));
    req->method        = method;
    req->path          = path;
    req->tenant_id     = tenant;
    req->enrolled_cnt  = student_count;
}

/* ---------------------------------------------------------------------------
 * Individual Test-Cases
 * ------------------------------------------------------------------------- */

/* Verify that a freshly registered route can be looked-up by the router. */
static void
test_register_and_lookup_route(void **state)
{
    test_ctx_t *ctx = *state;
    int rc = router_register_route(ctx->router,
                                   HTTP_GET,
                                   "/ping",
                                   ping_handler,
                                   NULL);
    assert_int_equal(rc, ROUTER_OK);

    const route_t *route = router_find(ctx->router, HTTP_GET, "/ping");
    assert_non_null(route);
    assert_ptr_equal(route->handler, ping_handler);
}

/* Verify dispatch for a happy path request. */
static void
test_basic_route_dispatch(void **state)
{
    test_ctx_t *ctx = *state;

    int rc = router_register_route(ctx->router,
                                   HTTP_GET,
                                   "/ping",
                                   ping_handler,
                                   NULL);
    assert_int_equal(rc, ROUTER_OK);

    request_t  req;
    response_t res;
    make_request(&req, HTTP_GET, "/ping", "tenant_A", 233);
    memset(&res, 0, sizeof(res));

    rc = router_handle_request(ctx->router, &req, &res);
    assert_int_equal(rc, ROUTER_OK);
    assert_int_equal(res.status_code, 200);
    assert_string_equal(res.body, "{ \"pong\": true }");
}

/* Verify that an unknown route produces ROUTER_ERR_NOT_FOUND and a 404. */
static void
test_dispatch_unknown_route(void **state)
{
    test_ctx_t *ctx = *state;

    request_t  req;
    response_t res;
    make_request(&req, HTTP_POST, "/nonexistent", "ghostTenant", 0);
    memset(&res, 0, sizeof(res));

    int rc = router_handle_request(ctx->router, &req, &res);
    assert_int_equal(rc, ROUTER_ERR_NOT_FOUND);
    assert_int_equal(res.status_code, 404);
}

/* Register two curriculum-year versions and make sure the correct one fires. */
static void
test_versioned_route_dispatch(void **state)
{
    test_ctx_t *ctx = *state;
    uint32_t    counter_2023 = 0;
    uint32_t    counter_2024 = 0;

    /* Register handlers for both major versions. */
    assert_int_equal(
        router_register_versioned(ctx->router,
                                  HTTP_POST,
                                  "/course/enroll",
                                  "v2023_Fall",
                                  counter_handler,
                                  &counter_2023),
        ROUTER_OK);

    assert_int_equal(
        router_register_versioned(ctx->router,
                                  HTTP_POST,
                                  "/course/enroll",
                                  "v2024_Spring",
                                  counter_handler,
                                  &counter_2024),
        ROUTER_OK);

    /* Call the newer API. */
    request_t  req_new;
    response_t res_new;
    make_request(&req_new, HTTP_POST, "/v2024_Spring/course/enroll",
                 "tenant_1", 123);
    memset(&res_new, 0, sizeof(res_new));
    assert_int_equal(router_handle_request(ctx->router, &req_new, &res_new),
                     ROUTER_OK);

    /* Call the older API. */
    request_t  req_old;
    response_t res_old;
    make_request(&req_old, HTTP_POST, "/v2023_Fall/course/enroll",
                 "tenant_1", 123);
    memset(&res_old, 0, sizeof(res_old));
    assert_int_equal(router_handle_request(ctx->router, &req_old, &res_old),
                     ROUTER_OK);

    assert_int_equal(counter_2024, 1);
    assert_int_equal(counter_2023, 1);
}

/* Validate that the router consults the throttling subsystem and returns
 * 429 when the “enrolled student” quota is exhausted.  We fake the throttle
 * module via cmocka’s mocking facilities. */
static void
test_throttled_route(void **state)
{
    test_ctx_t *ctx = *state;

    /* Register “ping” again; it should be throttled this time around. */
    assert_int_equal(
        router_register_route(ctx->router, HTTP_GET, "/ping",
                              ping_handler, NULL),
        ROUTER_OK);

    /* Tell the throttling module to claim that the user exceeded quota. */
    will_return(__wrap_throttle_allow, 0);           /* 0 == NOT ALLOWED */

    request_t  req;
    response_t res;
    make_request(&req, HTTP_GET, "/ping", "tenant_X", 999);
    memset(&res, 0, sizeof(res));

    int rc = router_handle_request(ctx->router, &req, &res);
    assert_int_equal(rc, ROUTER_ERR_THROTTLED);
    assert_int_equal(res.status_code, 429);
}

/* ---------------------------------------------------------------------------
 * Mocking of the throttling subsystem
 * ------------------------------------------------------------------------- */

/* In production, router calls `throttle_allow(...)`.  We intercept it here. */
int
__wrap_throttle_allow(const char   *tenant_id,
                      uint32_t      enrolled_cnt,
                      uint32_t      cost)
{
    (void)tenant_id;
    (void)enrolled_cnt;
    (void)cost;

    /* cmocka’s will_return()/mock() dance */
    return (int)mock();
}

/* ---------------------------------------------------------------------------
 * Test Runner
 * ------------------------------------------------------------------------- */
int
main(void)
{
    const struct CMUnitTest tests[] = {
        cmocka_unit_test_setup_teardown(test_register_and_lookup_route,
                                        setup, teardown),
        cmocka_unit_test_setup_teardown(test_basic_route_dispatch,
                                        setup, teardown),
        cmocka_unit_test_setup_teardown(test_dispatch_unknown_route,
                                        setup, teardown),
        cmocka_unit_test_setup_teardown(test_versioned_route_dispatch,
                                        setup, teardown),
        cmocka_unit_test_setup_teardown(test_throttled_route,
                                        setup, teardown),
    };

    return cmocka_run_group_tests(tests, NULL, NULL);
}