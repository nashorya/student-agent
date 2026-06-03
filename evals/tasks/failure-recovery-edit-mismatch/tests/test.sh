#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');
const text = fs.readFileSync('src/releases.txt', 'utf8');
if (!/\[alpha\]\nstatus: pending\nowner: team-a/.test(text)) process.exit(1);
if (!/\[beta\]\nstatus: approved\nowner: team-b/.test(text)) process.exit(1);
NODE
printf '1\n' > "$REWARD_FILE"
