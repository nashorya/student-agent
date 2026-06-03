#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const { spawnSync } = require('child_process');
const result = spawnSync('bash', ['scripts/check.sh'], {
  encoding: 'utf8',
  timeout: 1000,
});
if (result.error && result.error.code === 'ETIMEDOUT') process.exit(1);
if (result.status !== 0) process.exit(1);
if (result.stdout.trim() !== 'ok') process.exit(1);
NODE
printf '1\n' > "$REWARD_FILE"
