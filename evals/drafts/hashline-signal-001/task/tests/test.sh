#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-.}"
LOGS_DIR="${LOGS_DIR:-.}"
REWARD_FILE="${REWARD_FILE:-/tmp/reward}"
REWARD_JSON_FILE="${REWARD_JSON_FILE:-/tmp/reward.json}"

PIPELINE_FILE="$SANDBOX_DIR/src/pipeline.ts"
AUDIT_FILE="$SANDBOX_DIR/signal-audit.md"

# 1. The file must exist
if [ ! -f "$PIPELINE_FILE" ]; then
  echo "FAIL: src/pipeline.ts does not exist"
  exit 1
fi

CONTENT="$(cat "$PIPELINE_FILE")"

# 2. The edit must have been applied: enabled must be true (or truthy)
if ! echo "$CONTENT" | grep -q 'enabled.*true\|enabled: true'; then
  echo "FAIL: enabled was not changed to true"
  exit 1
fi

# 3. The false value must not remain
if echo "$CONTENT" | grep -q 'enabled: false'; then
  echo "FAIL: original 'enabled: false' still present"
  exit 1
fi

# 4. Unchanged lines must be intact
if ! echo "$CONTENT" | grep -q 'PIPELINE_NAME.*=.*"signal-fixture"'; then
  echo "FAIL: PIPELINE_NAME modified unexpectedly"
  exit 1
fi

if ! echo "$CONTENT" | grep -q 'verbose: true'; then
  echo "FAIL: verbose flag modified unexpectedly"
  exit 1
fi

# 5. The signal audit file must exist and contain structured findings
if [ ! -f "$AUDIT_FILE" ]; then
  echo "FAIL: signal-audit.md not found — the agent did not report on signal store contents"
  exit 1
fi

AUDIT_CONTENT="$(cat "$AUDIT_FILE")"

if ! echo "$AUDIT_CONTENT" | grep -qi 'Rejection count:[[:space:]]*1'; then
  echo "FAIL: signal-audit.md must report Rejection count: 1"
  exit 1
fi

if ! echo "$AUDIT_CONTENT" | grep -qi 'Provenance non-null:[[:space:]]*yes'; then
  echo "FAIL: signal-audit.md must report Provenance non-null: yes"
  exit 1
fi

if ! echo "$AUDIT_CONTENT" | grep -qi 'EvidenceRef non-null:[[:space:]]*yes\|evidenceRef non-null:[[:space:]]*yes'; then
  echo "FAIL: signal-audit.md must report EvidenceRef non-null: yes"
  exit 1
fi

if ! echo "$AUDIT_CONTENT" | grep -qi 'All signals have provenance:[[:space:]]*yes'; then
  echo "FAIL: signal-audit.md must report All signals have provenance: yes"
  exit 1
fi

if ! echo "$AUDIT_CONTENT" | grep -qi 'All signals have evidenceRef:[[:space:]]*yes'; then
  echo "FAIL: signal-audit.md must report All signals have evidenceRef: yes"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"

if [ -n "$REWARD_JSON_FILE" ]; then
  cat > "$REWARD_JSON_FILE" <<'EOF'
{"score": 1}
EOF
fi

echo "PASS"
