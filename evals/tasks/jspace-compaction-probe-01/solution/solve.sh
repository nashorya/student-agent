#!/usr/bin/env bash
set -euo pipefail

ledger_paths=(
  docs/ledgers/phase-1/identity-history-001.md
  docs/ledgers/phase-1/billing-continuity-002.md
  docs/ledgers/phase-1/archive-retention-003.md
  docs/ledgers/phase-1/gateway-availability-004.md
  docs/ledgers/phase-2/vendor-compatibility-004.md
  docs/ledgers/phase-2/regional-routing-005.md
  docs/ledgers/phase-2/legacy-id-sampling-006.md
  docs/ledgers/phase-2/retention-policy-007.md
  docs/ledgers/phase-3/deployment-cohort-007.md
  docs/ledgers/phase-3/account-reconciliation-008.md
  docs/ledgers/phase-3/report-tag-validation-009.md
  docs/ledgers/phase-4/runtime-readiness-010.md
  docs/ledgers/phase-4/operator-training-011.md
  docs/ledgers/phase-4/change-window-012.md
)
for ledger in "${ledger_paths[@]}"; do
  [[ -f "$ledger" ]]
done

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
