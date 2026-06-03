#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');
const actual = fs.readFileSync('src/catalog.txt', 'utf8').trimEnd().split('\n');
const expected = [
  ...Array.from({ length: 50 }, (_, index) => `entry-${String(index + 1).padStart(3, '0')} status=ready`),
  'entry-120 status=ready',
  'entry-121 status=ready',
  'entry-122 status=ready',
  'entry-123 status=ready',
  'entry-124 status=ready',
];

if (actual.length !== expected.length) {
  console.error(`Expected ${expected.length} lines, got ${actual.length}`);
  process.exit(1);
}

for (let index = 0; index < expected.length; index += 1) {
  if (actual[index] !== expected[index]) {
    console.error(`Line ${index + 1} mismatch: expected "${expected[index]}", got "${actual[index]}"`);
    process.exit(1);
  }
}
NODE
printf '1\n' > "$REWARD_FILE"
