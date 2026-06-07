#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

APP_FILE="$SANDBOX_DIR/src/app.ts"
REPORT_FILE="$SANDBOX_DIR/hashline-report.md"

# 1. The file must exist
if [ ! -f "$APP_FILE" ]; then
  echo "FAIL: src/app.ts does not exist"
  exit 1
fi

EXPECTED_APP="$(cat <<'EOF'
// Application configuration
const APP_NAME = "eval-fixture";
const VERSION = "1.0.0";

// Deployment status
const status = "reviewed";

// Team assignments
const owner = "team-alpha";

export { APP_NAME, VERSION, status, owner };
EOF
)"
CONTENT="$(cat "$APP_FILE")"

# 2. The final file must exactly match the reject-then-retry outcome.
if [ "$CONTENT" != "$EXPECTED_APP" ]; then
  echo "FAIL: src/app.ts does not match the expected final content"
  exit 1
fi

# 3. The recovery report must exist and describe the B path.
if [ ! -f "$REPORT_FILE" ]; then
  echo "FAIL: hashline-report.md not found"
  exit 1
fi

REPORT_CONTENT="$(cat "$REPORT_FILE")"

if ! echo "$REPORT_CONTENT" | grep -qi 'Stale rejection count.*1'; then
  echo "FAIL: hashline-report.md missing stale rejection count of 1"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Signal store event count.*1'; then
  echo "FAIL: hashline-report.md missing signal store event count of 1"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Re-read after rejection.*yes'; then
  echo "FAIL: hashline-report.md missing re-read confirmation"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Retry edit succeeded.*yes'; then
  echo "FAIL: hashline-report.md missing retry success confirmation"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
