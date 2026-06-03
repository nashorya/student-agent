#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');
const expected = [
  'Title: Eval fixture',
  'status: reviewed',
  'Notes: Keep this line exactly as it is.',
  '',
].join('\n');
const actual = fs.readFileSync('src/message.txt', 'utf8');
if (actual !== expected) {
  console.error('message.txt did not match the exact expected content');
  process.exit(1);
}
NODE
printf '1\n' > "$REWARD_FILE"
