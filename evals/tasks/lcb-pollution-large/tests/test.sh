#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const { proratedAmount } = require('./src/billing/proration.js');
const eq = (a, b) => Math.abs(a - b) < 1e-9;
if (!eq(proratedAmount(300, 15, 30), 150)) process.exit(1);
if (!eq(proratedAmount(120, 10, 30), 40)) process.exit(1);
if (!eq(proratedAmount(310, 31, 31), 310)) process.exit(1);
NODE
printf '1\n' > "$REWARD_FILE"
