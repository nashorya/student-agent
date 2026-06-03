#!/usr/bin/env bash
set -euo pipefail

grep -q 'function computeMode' src/features/target.ts
grep -q 'return "stable";' src/features/target.ts
! grep -q 'experimental' src/features/target.ts
printf '1\n' > "$REWARD_FILE"
