# Adversarial Test Cases — hashline-stale-reject-002

## known-bad: skip-one-file.sh

Applies edits to db.ts and cache.ts but skips auth.ts entirely. Two out of three files are correct, but auth.ts remains unchanged.

- Expected: **FAIL** — the test checks that retries was changed to 5 in auth.ts.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const port = 3000/const port = 5432/' src/db.ts
perl -0pi -e 's/const ttl = 60/const ttl = 300/' src/cache.ts
# Skip auth.ts edit
```

## known-bad: edit-wrong-file.sh

Applies edits to all three files but puts the db.ts change (port 5432) into cache.ts instead of db.ts, by writing `port: 5432` into cache.ts.

- Expected: **FAIL** — the cross-contamination check will detect that 5432 appears in cache.ts.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const ttl = 60/const port = 5432/' src/cache.ts
perl -0pi -e 's/const retries = 3/const retries = 5/' src/auth.ts
# db.ts not edited at all
```

## partial: only-first-file.sh

Applies the edit only to db.ts. The other two files are untouched.

- Expected: **FAIL** — cache.ts and auth.ts checks will fail.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const port = 3000/const port = 5432/' src/db.ts
```

## exploit: rewrite-all-files-completely.sh

Instead of making targeted edits, rewrites all three files entirely with the
correct content and fabricates the batch report. This bypasses the Hashline tag
mechanism entirely.

- Expected: **PASS** structurally — final file content and report values match.
  A full Hashline integration test would verify that the edits were performed
  through trusted tag-anchored operations rather than trusting the report.

```bash
#!/usr/bin/env bash
cat > src/db.ts <<'EOF'
// Database configuration
const DB_HOST = "localhost";
const port = 5432;
const DB_NAME = "app_db";

export { DB_HOST, port, DB_NAME };
EOF

cat > src/cache.ts <<'EOF'
// Cache configuration
const CACHE_DRIVER = "redis";
const ttl = 300;
const CACHE_PREFIX = "app:";

export { CACHE_DRIVER, ttl, CACHE_PREFIX };
EOF

cat > src/auth.ts <<'EOF'
// Auth configuration
const AUTH_PROVIDER = "oauth2";
const retries = 5;
const AUTH_TIMEOUT_MS = 10000;

export { AUTH_PROVIDER, retries, AUTH_TIMEOUT_MS };
EOF

cat > hashline-batch-report.md <<'REPORT'
## Hashline Batch Recovery Report
- Stale rejection count: 3
- Signal store event count: 3
- Re-read all files after rejection: yes
- Retry edits succeeded: yes
REPORT
```

## alternative-valid: sequential-sed-edits.sh

Uses sed to apply the same three edits in sequence. The tool choice is different but the outcome is identical.

- Expected: **PASS** — all three files have correct values and unchanged lines are intact.

```bash
#!/usr/bin/env bash
sed -i 's/const port = 3000/const port = 5432/' src/db.ts
sed -i 's/const ttl = 60/const ttl = 300/' src/cache.ts
sed -i 's/const retries = 3/const retries = 5/' src/auth.ts
cat > hashline-batch-report.md <<'REPORT'
## Hashline Batch Recovery Report
- Stale rejection count: 3
- Signal store event count: 3
- Re-read all files after rejection: yes
- Retry edits succeeded: yes
REPORT
```
