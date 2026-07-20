#!/usr/bin/env bash
set -euo pipefail
node tests/run.mjs
printf '1\n' > "$REWARD_FILE"
