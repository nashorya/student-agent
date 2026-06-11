```markdown
# EduGate ScholarLink &mdash; API Gateway for Learning Platforms  
> Because every *microservice* deserves a good education.

[![Build Status](https://github.com/acme-edu/EduGate_ScholarLink/actions/workflows/ci.yml/badge.svg)](https://github.com/acme-edu/EduGate_ScholarLink/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Chat on Slack](https://img.shields.io/badge/Slack-Join%20us-blue?logo=slack)](https://edu-gate.slack.com)

---

## ✨ What is ScholarLink?
EduGate ScholarLink is a **small-footprint, embeddable API Gateway** written in C.  
While its runtime weighs in at <750 kB, it packs the same gateway topics you find in
enterprise-grade solutions:

* Curriculum-driven Versioning (`v2024_Spring`, `v2024_Fall`…)
* JSON Schema & GraphQL validation
* GraphQL Schema stitching
* Pluggable authentication / authorization
* Circuit-breaking and request throttling expressed as   
  *requests per enrolled student*
* Prometheus & OpenTelemetry monitoring
* Live “API Syllabus” documentation (Swagger + GraphiQL)

The project doubles as a **teaching aid**: every line of code is designed to be read,
modified, and compared with alternative implementations.

---

## 📂 Directory Layout

```
EduGate_ScholarLink/
├── include/              # Public headers (stable API)
├── src/                  # Gateway implementation
│   ├── core/             # Routing, pipelines, config loader
│   ├── modules/          # Plug-in modules: auth, gql, metrics …
│   └── platform/         # POSIX & platform glue
├── configs/              # YAML config templates
├── tests/                # Unit & Integration tests (μTest + CTest)
├── examples/             # Getting-started sample micro-services
└── README.md             # This file
```

---

## ⚡️ Quick Start

### Prerequisites
* GCC ≥ 11 or Clang ≥ 14  
* CMake ≥ 3.20  
* `libcurl`, `libmicrohttpd`, `jansson`, `yaml`, `graphqlparser`, `prometheus-c`

### Build & Run

```bash
git clone https://github.com/acme-edu/EduGate_ScholarLink.git
cd EduGate_ScholarLink
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
./build/bin/scholarlinkd -c configs/local_dev.yaml
```

If everything went well, visit <http://localhost:8080/docs> and explore the **API Syllabus**.

---

## 🧩 Configuring the Gateway

A minimal configuration is written in YAML with strongly-typed schema validation:

```yaml
# configs/local_dev.yaml
gateway:
  listen: "0.0.0.0:8080"
  tls:
    enabled: false
  throttling:
    # Allow 200 requests / minute / enrolled student
    rpm_per_student: 200
  versions:
    - id: "v2024_Spring"
      path_prefix: "/v1"
      upstream:
        type:  "rest"
        target: "http://localhost:9001"
    - id: "v2024_Spring_GQL"
      path_prefix: "/gql"
      upstream:
        type:  "graphql"
        target: "http://localhost:9002/graphql"

monitoring:
  prometheus:
    scrape_path: "/metrics"
    enabled: true
```

Reload the file **without downtime**:

```bash
kill -HUP $(pidof scholarlinkd)
```

---

## 🔬 Code Snippets

Below are condensed yet production-grade excerpts illustrating typical extension points.

### 1. Registering a Custom Middleware

```c
/* src/modules/mw_rate_limit.c */

#include "sl_core.h"            /* Core APIs */
#include "sl_modules.h"         /* Module registration helpers */
#include <time.h>

typedef struct {
    uint32_t max_rpm_per_student;
} rl_conf_t;

static rl_conf_t g_cfg;

/* Simple token bucket keyed by <student_id>. */
static bool rl_handle_request(sl_request_t *req, sl_response_t *res) {
    const char *sid = sl_req_header(req, "X-Student-ID");
    if (!sid) {
        return sl_res_error(res, SL_HTTP_400_BAD_REQUEST,
                            "Missing header: X-Student-ID");
    }

    uint64_t now_ms = sl_time_epoch_ms();
    bool ok = sl_tokbucket_consume(sid, now_ms,
                                   g_cfg.max_rpm_per_student, 60 * 1000);
    if (!ok) {
        return sl_res_error(res, SL_HTTP_429_TOO_MANY_REQUESTS,
                            "Throttle limit reached — take a breather 🤓");
    }
    return SL_NEXT; /* continue pipeline */
}

static sl_status_t rl_init(const yaml_node_t *cfg) {
    g_cfg.max_rpm_per_student =
        yaml_node_uint(cfg, "rpm_per_student", 120U); /* sensible default */
    return SL_OK;
}

/* Module descriptor consumed by the dynamic loader */
SL_MODULE_EXPORT const sl_module_t sl_module = {
    .name    = "rate_limit_mw",
    .version = SL_SEMVER(1,0,0),
    .init    = rl_init,
    .on_req  = rl_handle_request,
};
```

Compile as a shared object and drop it into `lib/modules/`, the loader will pick it up
at boot.

### 2. Stitching GraphQL Schemas

```c
/* src/core/gql_stitcher.c */

#include "sl_graphql.h"

sl_gql_schema_t *sl_gql_stitch(const char **documents, size_t n_docs,
                               sl_error_t *err_out)
{
    sl_gql_schema_t *schema = sl_gql_schema_create();

    for (size_t i = 0; i < n_docs; ++i) {
        if (!sl_gql_schema_merge(schema, documents[i], err_out)) {
            sl_gql_schema_destroy(schema);
            return NULL;
        }
    }
    /* Inject domain-specific directives */
    const char *edu_directives =
        "directive @learningObjective(code:String!) on FIELD_DEFINITION";
    if (!sl_gql_schema_merge(schema, edu_directives, err_out)) {
        sl_gql_schema_destroy(schema);
        return NULL;
    }
    return schema;
}
```

---

## 📊 Monitoring & Metrics

ScholarLink exposes native Prometheus counters:

| Metric | Labels | Meaning |
|--------|--------|---------|
| `sl_http_requests_total` | `method`, `status`, `objective` | Request count |
| `sl_request_duration_seconds` | `method`, `objective` | Latency histogram |
| `sl_throttle_drops_total` | `version`, `route` | Requests dropped by rate-limiter |

Add the scrape job to your `prometheus.yml`:

```yaml
- job_name: scholarlink
  static_configs:
    - targets: ['localhost:8080']
```

Grafana dashboard JSON is available under `monitoring/grafana/`.

---

## 🧪 Testing

We ship a dual-layer test suite:

* **μTest** (unit tests, mocking)  
* **CTest** (system + contract tests)

Run them via:

```bash
cmake --build build --target test
```

Coverage reports (gcc‐lcov) appear in `build/coverage/`.

---

## 🚀 Deploy to Production

A stripped static binary is <700 kB:

```bash
cmake -B build_rel -DCMAKE_BUILD_TYPE=MinSizeRel -DSTATIC_LINK=ON
cmake --build build_rel --target scholarlinkd
strip build_rel/bin/scholarlinkd
```

Containerize with the provided `Dockerfile.alpine`:

```
docker build -f Dockerfile.alpine -t scholarlink:latest .
docker run -p 8080:8080 scholarlink:latest
```

Zero-config autoscaling on Kubernetes is achieved with the
`k8s/helm-chart/` included in the repo.

---

## 🤝 Contributing

1. Fork & create a feature branch (`git checkout -b feat/my-feature`)
2. Follow the **coding style** (`clang-format -style=file`) and ensure:
   * `make lint` passes (clang-tidy, cppcheck)
   * Unit tests are green
3. Write/update documentation
4. Submit a PR — we use conventional commits (`feat:`, `fix:`, `docs:`…)

---

## 📄 License & Credits
Licensed under the MIT license.  
Inspired by excellent open-source mentors, educators, and the community.

> “We teach best what we most need to learn.” — Richard Bach

Happy Hacking & Learning! 🎓
```