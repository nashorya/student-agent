#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

PROCESS_FILE="$SANDBOX_DIR/src/process.ts"
REPORT_FILE="$SANDBOX_DIR/tool-error-signal-report.md"

# 1. The file must exist
if [ ! -f "$PROCESS_FILE" ]; then
  echo "FAIL: src/process.ts does not exist"
  exit 1
fi

CONTENT="$(cat "$PROCESS_FILE")"

# 2. The value extraction bug must be fixed: missing values must become 0.
# Accept nullish handling or an explicit undefined check.
if ! echo "$CONTENT" | grep -qE '(r\.value\s*\?\?\s*0|r\?\.value\s*\?\?\s*0|r\.value\s*!==\s*undefined|typeof[[:space:]]+r\.value\s*!==\s*["'\'']undefined["'\''])'; then
  echo "FAIL: the extractValues function does not handle undefined values"
  exit 1
fi

# 3. A sumValues function must be exported
if ! echo "$CONTENT" | grep -q 'function sumValues\|const sumValues\|sumValues\s*='; then
  echo "FAIL: sumValues function not found"
  exit 1
fi

if ! echo "$CONTENT" | grep -q 'export.*sumValues\|sumValues.*export'; then
  echo "FAIL: sumValues is not exported"
  exit 1
fi

# 4. The sumValues function must handle undefined values (treating as 0)
# Check that sumValues references some form of null/undefined handling or optional chaining
SUMVAL_BLOCK="$(echo "$CONTENT" | sed -n '/sumValues/,/}/p' | head -20)"
if echo "$SUMVAL_BLOCK" | grep -qE '(\?\?|reduce|\.value|optional)'; then
  : # sumValues handles values, acceptable
else
  # Also acceptable: filter + map pattern
  if ! echo "$SUMVAL_BLOCK" | grep -qE '(filter|map|\.value)'; then
    echo "FAIL: sumValues does not appear to process DataItem values"
    exit 1
  fi
fi

# 5. The signal report must exist and claim the trusted trace values that a
# full signal-pipeline harness will later cross-check.
if [ ! -f "$REPORT_FILE" ]; then
  echo "FAIL: tool-error-signal-report.md not found"
  exit 1
fi

REPORT_CONTENT="$(cat "$REPORT_FILE")"

if ! echo "$REPORT_CONTENT" | grep -qi 'Tool error count:[[:space:]]*1'; then
  echo "FAIL: tool-error-signal-report.md must report Tool error count: 1"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Provenance non-null:[[:space:]]*yes'; then
  echo "FAIL: tool-error-signal-report.md must report Provenance non-null: yes"
  exit 1
fi

if ! echo "$REPORT_CONTENT" | grep -qi 'Main task continued after error:[[:space:]]*yes'; then
  echo "FAIL: tool-error-signal-report.md must report Main task continued after error: yes"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
