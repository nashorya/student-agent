#!/usr/bin/env bash
set -euo pipefail

# The smoke task intentionally records the one allowed failed decoy attempt.
bash scripts/legacy-migrate.sh || true

cat > src/recovery-config.json <<'JSON'
{
  "recoveryVersion": 2,
  "compatibilityMode": "bridge",
  "preserveLegacyIds": true,
  "reportTag": "APAC-R7"
}
JSON

cat > src/runner.ts <<'TS'
import config from './recovery-config.json' with { type: 'json' };

console.log(
  `Recovery v${config.recoveryVersion}: mode=${config.compatibilityMode}; ` +
  `preserveLegacyIds=${config.preserveLegacyIds}; reportTag=${config.reportTag}`,
);
TS

cat >> docs/ops-checklist.md <<'MD'
- Run npx tsx src/runner.ts
- Confirm the one-time recovery ticket was removed
- Do not retry JSPACE_SMOKE_DECOY_LEGACY_SCHEMA_V1
MD

rm -f inbox/recovery-ticket.txt
