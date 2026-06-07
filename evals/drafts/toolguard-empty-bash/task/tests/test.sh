#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

CONFIG_FILE="$SANDBOX_DIR/src/config.json"
REPORT_FILE="$SANDBOX_DIR/toolguard-report.md"

# 1. The file must exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "FAIL: src/config.json does not exist"
  exit 1
fi

# 2. config.json must remain valid JSON and only env/debug may reflect the fixture.
node - "$CONFIG_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const expected = {
  name: 'eval-fixture',
  env: 'production',
  version: '1.0.0',
  debug: true,
  port: 3000,
};
for (const [key, value] of Object.entries(expected)) {
  if (cfg[key] !== value) {
    console.error(`FAIL: ${key} field mismatch: expected ${JSON.stringify(value)}, got ${JSON.stringify(cfg[key])}`);
    process.exit(1);
  }
}
for (const key of Object.keys(cfg)) {
  if (!(key in expected)) {
    console.error(`FAIL: unexpected key ${key}`);
    process.exit(1);
  }
}
NODE

# 3. The ToolGuard report must exist and describe the protected trace outcome
# that a full integration harness will later cross-check.
if [ ! -f "$REPORT_FILE" ]; then
  echo "FAIL: toolguard-report.md not found"
  exit 1
fi

REPORT_CONTENT="$(cat "$REPORT_FILE")"

if ! echo "$REPORT_CONTENT" | grep -qi 'Empty bash block observed:[[:space:]]*yes'; then
  echo "FAIL: toolguard-report.md must report Empty bash block observed: yes"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Shell execution count for empty bash:[[:space:]]*0'; then
  echo "FAIL: toolguard-report.md must report Shell execution count for empty bash: 0"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Final config verified:[[:space:]]*yes'; then
  echo "FAIL: toolguard-report.md must report Final config verified: yes"
  exit 1
fi


printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
