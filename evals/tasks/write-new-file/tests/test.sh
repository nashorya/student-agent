#!/usr/bin/env bash
set -euo pipefail

test -f docs/summary.md
diff -u docs/summary.md - <<'EXPECTED'
# Baseline Summary

Baseline ready.
EXPECTED
printf '1\n' > "$REWARD_FILE"
