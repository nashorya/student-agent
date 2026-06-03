#!/usr/bin/env bash
set -euo pipefail

grep -qx 'name=alpha' src/alpha.txt
grep -qx 'name=beta' src/beta.txt
grep -qx 'color=blue' src/alpha.txt
grep -qx 'color=blue' src/beta.txt
! grep -Rqx 'color=red' src
printf '1\n' > "$REWARD_FILE"
