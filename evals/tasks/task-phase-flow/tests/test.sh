#!/usr/bin/env bash
set -euo pipefail

grep -qx 'Phase A: done' project.txt
grep -qx 'Phase B: done' project.txt
! grep -q 'todo' project.txt
printf '1\n' > "$REWARD_FILE"
