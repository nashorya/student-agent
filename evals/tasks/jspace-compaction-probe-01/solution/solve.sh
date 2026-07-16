#!/usr/bin/env bash
set -euo pipefail

cat > src/migration-config.json <<'JSON'
{
  "migrationVersion": 2,
  "compatibilityMode": "bridge",
  "preserveLegacyIds": true,
  "reportTag": "APAC-R7"
}
JSON

cat > src/runner.ts <<'TS'
import config from './migration-config.json' with { type: 'json' };

console.log(
  `Migration v${config.migrationVersion}: mode=${config.compatibilityMode}; ` +
  `preserveLegacyIds=${config.preserveLegacyIds}; reportTag=${config.reportTag}`,
);
TS

cat >> docs/ops-checklist.md <<'MD'
- Run npx tsx src/runner.ts
- Confirm the one-time vendor response was removed
- Do not retry JSPACE_DECOY_LEGACY_SCHEMA_V1
MD

rm -f inbox/vendor-response.txt
