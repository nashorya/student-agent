#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');
const path = 'src/config.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.enabled = true;
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
NODE
