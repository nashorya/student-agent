```markdown
# EduGate ScholarLink – API Gateway Guide  
*(File: docs/API_GUIDE.md)*

Welcome to EduGate ScholarLink, an educationally-flavored API Gateway that unifies
course-centric micro-services behind a single, policy-driven endpoint.  
This guide targets **C programmers** who will embed / consume gateway calls from
EDD-compliant learning applications, CLI utilities, or embedded devices.

---

## Table of Contents
1. Quick‐Start
2. Versioning Model
3. Authentication & Authorization
4. REST Endpoints
   1. Course Catalog
   2. Student Profiles
   3. Assessments
   4. Analytics
5. GraphQL Endpoint
6. Request Validation
7. Error Handling
8. Monitoring & Metrics
9. Code Examples (libcurl / POSIX)
10. Appendix – JSON Schemas & GraphQL SDL

---

## 1. Quick-Start

```bash
# Acquire the gateway binary (pre-built static build)
curl -LO https://downloads.edugate.io/scholarlink/v2024_Spring/eg_gateway-x86_64

chmod +x eg_gateway-x86_64
./eg_gateway-x86_64 serve \
      --config  ./conf/sample.toml \
      --metrics :9090 \
      --docs    :8081
```

The gateway will start listening on `127.0.0.1:8080` (REST) and
`127.0.0.1:8082/graphql` (GraphQL). Swagger-UI is automatically exposed at
`http://localhost:8081/swagger`.

---

## 2. Versioning Model

• Semantic segments map to academic cycles:  
  `v<YEAR>_<TERM>` → `v2024_Spring`, `v2024_Fall`, etc.  
• **Major** changes = curriculum overhaul (breaking).  
• **Minor** changes = elective module update (non-breaking).  
• **Patch**       = typos / doc only.  

Endpoints embed the alias:

```
/api/v2024_Spring/courses
/api/v2024_Spring/students
```

Both `Accept-Version: v2024_Spring` **and** URL versioning are supported; the
header wins when both supplied.

---

## 3. Authentication & Authorization

| Mechanism  | Transport | Scope            | Comment                       |
|------------|-----------|------------------|------------------------------|
| JWT        | HTTPS     | Student, Tutor   | Default, 15-minute TTL       |
| HMAC-256   | HTTPS     | Service → GW     | For internal micro-services  |
| mTLS       | TLS       | Admin            | Requires PKI enrollment      |

JWT claims:

```json
{
  "sub": "stu_8D2AB1",
  "role": "student",      // 'tutor', 'admin'
  "enrollment": ["BIO101", "CSC150"],
  "exp": 1719844221
}
```

Attach token via:

```
Authorization: Bearer <jwt>
```

---

## 4. REST Endpoints (excerpt)

### 4.1 Course Catalog

```
GET /api/v2024_Spring/courses               → 200 [CourseList]
GET /api/v2024_Spring/courses/{course_id}   → 200 [Course]
POST /api/v2024_Spring/courses/{course_id}/enroll
```

Request throttling is expressed in **“requests per enrolled student”**:

```
X-Rate-Limit-Learning: 60; unit=minute; student_id=stu_8D2AB1
```

### 4.2 Student Profiles

```
GET /api/v2024_Spring/students/{student_id}
PATCH /api/v2024_Spring/students/{student_id}
```

Body must pass JSON Schema `student_v1.schema.json` (see Appendix).

### 4.3 Assessments

```
POST /api/v2024_Spring/quizzes/{quiz_id}/answers
GET  /api/v2024_Spring/quizzes/{quiz_id}/result
```

### 4.4 Analytics

```
GET /api/v2024_Spring/analytics/engagement?course_id=CSC150
```

Admin-only; requires `role=admin` in JWT.

---

## 5. GraphQL Endpoint

```
POST /graphql
```

Supply `x-edugate-version: v2024_Spring` header if you need a historical schema.

Example query:

```graphql
query GetStudentProgress($sid: ID!) {
  student(id: $sid) {
    fullName
    enrolledCourses {
      id
      title
      progress { completed percentage }
    }
  }
}
```

Gateway stitches micro-service schemas at startup; introspection is **enabled**
in non-prod.

---

## 6. Request Validation

Every incoming request is checked against pre-registered JSON Schemas or
GraphQL SDL constraints.

### Enabling strict mode (config snippet)

```toml
[validator]
mode        = "strict"     # "warn" | "off"
maxBodySize = "2MiB"
```

Validation failure returns **422 Unprocessable Entity**.

---

## 7. Error Handling

| HTTP | Code | Title                      | Description                              |
|------|------|---------------------------|------------------------------------------|
| 400  | E400 | BadRequest                | Malformed syntax                         |
| 401  | E401 | Unauthorized              | Missing / bad token                      |
| 403  | E403 | Forbidden                 | No permission                            |
| 404  | E404 | NotFound                  | Resource not found                       |
| 409  | E409 | Conflict                  | Enrollment rule violated                 |
| 422  | E422 | ValidationFailed          | Body failed JSON Schema                  |
| 429  | E429 | RateLimitExceeded         | Calm down, student!                      |
| 500  | E500 | InternalServerError       | Unexpected error                         |
| 502  | E502 | UpstreamUnavailable       | Micro-service offline                    |

Error format (JSON):

```json
{
  "error": {
    "code": "E422",
    "title": "ValidationFailed",
    "detail": "Field 'email' must be a valid academic address.",
    "meta": {
      "schema": "student_v1.schema.json",
      "trace_id": "b58b66c7-57d0-46ea-9c9e-ab21bde2de3f"
    }
  }
}
```

---

## 8. Monitoring & Metrics

Prometheus endpoint: `GET /metrics` (text/plain, port `:9090` by default)

Sample metrics (pedagogic labels):

```
eg_route_requests_total{endpoint="/v1/quiz",objective="FormativeAssessment"} 1488
eg_rate_limit_rejections_total{student_id="stu_8D2AB1"} 12
eg_validator_failures_total{schema="student_v1"} 3
```

Grafana dashboards located under `./ops/grafana/*`.

---

## 9. Code Examples (libcurl, POSIX)

The following C snippet performs a secure enrollment
(`POST /courses/{id}/enroll`) while handling gateway-specific throttling and
back-off headers.

```c
/*
 * enroll.c – Example client for EduGate ScholarLink
 *
 * Build:
 *   cc enroll.c -o enroll -lcurl -Wall -Wextra -pedantic
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>

#define GATEWAY_URL "https://api.edugate.io/api/v2024_Spring"
#define AUTH_TOKEN  "REPLACE_WITH_JWT"

static size_t discard_cb(void *ptr, size_t size, size_t nmemb, void *userdata) {
    (void)ptr; (void)userdata;
    return size * nmemb;   /* we /dev/null the response body */
}

static void die(const char *msg, CURLcode code) {
    fprintf(stderr, "libcurl: %s (%s)\n", msg, curl_easy_strerror(code));
    exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "Usage: %s course_id\n", argv[0]);
        return EXIT_FAILURE;
    }

    const char *course_id = argv[1];
    char url[256];
    snprintf(url, sizeof url, "%s/courses/%s/enroll", GATEWAY_URL, course_id);

    CURL *curl = curl_easy_init();
    if (!curl) {
        fputs("curl_easy_init failed\n", stderr);
        return EXIT_FAILURE;
    }

    struct curl_slist *hdrs = NULL;
    hdrs = curl_slist_append(hdrs, "Content-Type: application/json");
    hdrs = curl_slist_append(hdrs, "Accept: application/json");
    hdrs = curl_slist_append(hdrs, "User-Agent: EduGate-CLI/1.0");
    hdrs = curl_slist_append(hdrs, "Authorization: Bearer " AUTH_TOKEN);

    /* Optional: override curriculum version without URL param */
    hdrs = curl_slist_append(hdrs, "Accept-Version: v2024_Spring");

    const char *payload = "{}"; /* enrollment has no body today */

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_cb);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

    CURLcode rc = curl_easy_perform(curl);
    if (rc != CURLE_OK)
        die("request failed", rc);

    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

    /* Handle rate limiting based on learning semantics */
    if (http_code == 429) {
        long retry_after = 0;
        curl_easy_getinfo(curl, CURLINFO_RETRY_AFTER, &retry_after);
        fprintf(stderr, "Rate‐limit hit; retry in %ld second(s).\n", retry_after);
    } else if (http_code >= 400) {
        fprintf(stderr, "Gateway error: HTTP %ld\n", http_code);
    } else {
        puts("Enrollment succeeded 🎓");
    }

    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    return (http_code == 201) ? EXIT_SUCCESS : EXIT_FAILURE;
}
```

---

## 10. Appendix

### 10.1 Student Profile JSON Schema `student_v1.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "student_v1.schema.json",
  "title": "StudentProfile",
  "type": "object",
  "required": ["id", "email", "full_name", "enrollment_year"],
  "properties": {
    "id":            { "type": "string", "pattern": "^stu_[A-F0-9]{6}$" },
    "email":         { "type": "string", "format": "email" },
    "full_name":     { "type": "string", "minLength": 1 },
    "enrollment_year": { "type": "integer", "minimum": 2000 },
    "majors": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 3
    }
  },
  "additionalProperties": false
}
```

### 10.2 GraphQL SDL (excerpt)

```graphql
type Query {
  course(id: ID!): Course!
  student(id: ID!): Student!
  quiz(id: ID!): Quiz!
}

type Course {
  id: ID!
  title: String!
  credits: Int!
  catalogYear: Int!
}

type Student {
  id: ID!
  fullName: String!
  enrolledCourses: [Course!]!
}

type Mutation {
  enroll(studentId: ID!, courseId: ID!): EnrollmentResponse!
}
```

---

© 2024 EduGate ScholarLink. All rights reserved.
```