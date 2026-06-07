#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

STORE_FILE="$SANDBOX_DIR/src/store.ts"
REPORT_FILE="$SANDBOX_DIR/snapshot-report.md"

# 1. The file must exist
if [ ! -f "$STORE_FILE" ]; then
  echo "FAIL: src/store.ts does not exist"
  exit 1
fi

CONTENT="$(cat "$STORE_FILE")"

# 2. The edit must have been applied: logLevel must be "info"
if ! echo "$CONTENT" | grep -q 'logLevel.*=.*"info"'; then
  echo "FAIL: logLevel was not changed to info"
  exit 1
fi

# 3. The old value must not remain
if echo "$CONTENT" | grep -q '"debug"'; then
  echo "FAIL: original logLevel 'debug' still present"
  exit 1
fi

# 4. Unchanged lines must be intact
if ! echo "$CONTENT" | grep -q 'STORE_NAME.*=.*"snapshot-fixture"'; then
  echo "FAIL: STORE_NAME modified unexpectedly"
  exit 1
fi

if ! echo "$CONTENT" | grep -q 'verbose.*=.*true'; then
  echo "FAIL: verbose modified unexpectedly"
  exit 1
fi

if ! echo "$CONTENT" | grep -q 'MAX_CONNECTIONS.*=.*10'; then
  echo "FAIL: MAX_CONNECTIONS modified unexpectedly"
  exit 1
fi

# 5. The snapshot report must exist and contain required fields
if [ ! -f "$REPORT_FILE" ]; then
  echo "FAIL: snapshot-report.md not found — the agent did not report on the snapshot mechanism"
  exit 1
fi

REPORT_CONTENT="$(cat "$REPORT_FILE")"

if ! echo "$REPORT_CONTENT" | grep -qi 'File read:[[:space:]]*yes'; then
  echo "FAIL: snapshot-report.md must report File read: yes"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Content tag received:[[:space:]]*yes'; then
  echo "FAIL: snapshot-report.md must report Content tag received: yes"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Edit succeeded:[[:space:]]*yes'; then
  echo "FAIL: snapshot-report.md must report Edit succeeded: yes"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Tag used for edit matched read tag:[[:space:]]*yes'; then
  echo "FAIL: snapshot-report.md must report Tag used for edit matched read tag: yes"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
