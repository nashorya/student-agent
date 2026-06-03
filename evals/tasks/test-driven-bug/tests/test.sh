#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const { add } = require('./src/calculator.js');
if (add(2, 3) !== 5) process.exit(1);
if (add(-2, 3) !== 1) process.exit(1);
NODE
printf '1\n' > "$REWARD_FILE"
