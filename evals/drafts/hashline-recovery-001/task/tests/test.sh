#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

CONFIG_FILE="$SANDBOX_DIR/src/config.ts"

# 1. The file must exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "FAIL: src/config.ts does not exist"
  exit 1
fi

CONTENT="$(cat "$CONFIG_FILE")"

# 2. All three edits must have been applied
#    Edit 1: version "1.0.0" → "2.0.0"
if ! echo "$CONTENT" | grep -q 'version.*=.*"2.0.0"'; then
  echo "FAIL: version was not changed to 2.0.0"
  exit 1
fi

#    Edit 2: status "draft" → "published"
if ! echo "$CONTENT" | grep -q 'status.*=.*"published"'; then
  echo "FAIL: status was not changed to published"
  exit 1
fi

#    Edit 3: owner "dev" → "prod"
if ! echo "$CONTENT" | grep -q 'owner.*=.*"prod"'; then
  echo "FAIL: owner was not changed to prod"
  exit 1
fi

# 3. Old values must not remain
if echo "$CONTENT" | grep -q '"1.0.0"'; then
  echo "FAIL: original version '1.0.0' still present"
  exit 1
fi

if echo "$CONTENT" | grep -q '"draft"'; then
  echo "FAIL: original status 'draft' still present"
  exit 1
fi

if echo "$CONTENT" | grep -q '"dev"'; then
  echo "FAIL: original owner 'dev' still present"
  exit 1
fi

# 4. Unchanged lines must be intact
if ! echo "$CONTENT" | grep -q 'APP_NAME.*=.*"chain-fixture"'; then
  echo "FAIL: APP_NAME modified unexpectedly"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
