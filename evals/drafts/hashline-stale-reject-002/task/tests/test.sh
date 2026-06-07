#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

DB_FILE="$SANDBOX_DIR/src/db.ts"
CACHE_FILE="$SANDBOX_DIR/src/cache.ts"
AUTH_FILE="$SANDBOX_DIR/src/auth.ts"
REPORT_FILE="$SANDBOX_DIR/hashline-batch-report.md"

# 1. All three files must exist
for f in "$DB_FILE" "$CACHE_FILE" "$AUTH_FILE"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f does not exist"
    exit 1
  fi
done

EXPECTED_DB="$(cat <<'EOF'
// Database configuration
const DB_HOST = "localhost";
const port = 5432;
const DB_NAME = "app_db";

export { DB_HOST, port, DB_NAME };
EOF
)"

EXPECTED_CACHE="$(cat <<'EOF'
// Cache configuration
const CACHE_DRIVER = "redis";
const ttl = 300;
const CACHE_PREFIX = "app:";

export { CACHE_DRIVER, ttl, CACHE_PREFIX };
EOF
)"

EXPECTED_AUTH="$(cat <<'EOF'
// Auth configuration
const AUTH_PROVIDER = "oauth2";
const retries = 5;
const AUTH_TIMEOUT_MS = 10000;

export { AUTH_PROVIDER, retries, AUTH_TIMEOUT_MS };
EOF
)"

DB_CONTENT="$(cat "$DB_FILE")"
CACHE_CONTENT="$(cat "$CACHE_FILE")"
AUTH_CONTENT="$(cat "$AUTH_FILE")"

# 2. All three files must exactly match the reject-then-retry outcome.
if [ "$DB_CONTENT" != "$EXPECTED_DB" ]; then
  echo "FAIL: src/db.ts does not match the expected final content"
  exit 1
fi

if [ "$CACHE_CONTENT" != "$EXPECTED_CACHE" ]; then
  echo "FAIL: src/cache.ts does not match the expected final content"
  exit 1
fi

if [ "$AUTH_CONTENT" != "$EXPECTED_AUTH" ]; then
  echo "FAIL: src/auth.ts does not match the expected final content"
  exit 1
fi

# 3. The batch recovery report must exist and describe the B path.
if [ ! -f "$REPORT_FILE" ]; then
  echo "FAIL: hashline-batch-report.md not found"
  exit 1
fi

REPORT_CONTENT="$(cat "$REPORT_FILE")"

if ! echo "$REPORT_CONTENT" | grep -qi 'Stale rejection count.*3'; then
  echo "FAIL: hashline-batch-report.md missing stale rejection count of 3"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Signal store event count.*3'; then
  echo "FAIL: hashline-batch-report.md missing signal store event count of 3"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Re-read all files after rejection.*yes'; then
  echo "FAIL: hashline-batch-report.md missing all-files re-read confirmation"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Retry edits succeeded.*yes'; then
  echo "FAIL: hashline-batch-report.md missing retry success confirmation"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
