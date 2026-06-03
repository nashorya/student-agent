#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('src/config.json', 'utf8'));
const keys = Object.keys(config).sort().join(',');
if (keys !== 'enabled,features,name,version') process.exit(1);
if (config.name !== 'eval-fixture') process.exit(1);
if (config.version !== 3) process.exit(1);
if (!Array.isArray(config.features) || config.features.join(',') !== 'read,edit') process.exit(1);
if (config.enabled !== true) process.exit(1);
NODE
printf '1\n' > "$REWARD_FILE"
