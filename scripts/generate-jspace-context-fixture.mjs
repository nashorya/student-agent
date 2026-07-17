import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const docsRoot = 'evals/tasks/jspace-compaction-probe-01/environment/docs';
const segments = [
  segment(1, 'identity-history-001.md', 'identity access history', 'IDENTITY-CONTROL-VERIFIED'),
  segment(1, 'billing-continuity-002.md', 'billing continuity history', 'BILLING-CONTROL-VERIFIED'),
  segment(1, 'archive-retention-003.md', 'archive retention history', 'ARCHIVE-CONTROL-VERIFIED'),
  segment(1, 'gateway-availability-004.md', 'gateway availability history'),
  segment(2, 'vendor-compatibility-004.md', 'vendor compatibility review', undefined, true),
  segment(2, 'regional-routing-005.md', 'regional routing review'),
  segment(2, 'legacy-id-sampling-006.md', 'legacy ID sampling'),
  segment(2, 'retention-policy-007.md', 'retention policy review'),
  segment(3, 'deployment-cohort-007.md', 'deployment cohort evidence'),
  segment(3, 'account-reconciliation-008.md', 'account reconciliation evidence'),
  segment(3, 'report-tag-validation-009.md', 'report tag validation'),
  segment(4, 'runtime-readiness-010.md', 'runtime readiness evidence'),
  segment(4, 'operator-training-011.md', 'operator training evidence'),
  segment(4, 'change-window-012.md', 'change window evidence'),
];

await rm(join(docsRoot, 'context-ledgers'), { recursive: true, force: true });
await rm(join(docsRoot, 'ledgers'), { recursive: true, force: true });

for (const item of segments) {
  const outputPath = join(docsRoot, 'ledgers', `phase-${item.phase}`, item.file);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildLedger(item), 'utf8');
}

function segment(phase, file, subject, marker, decisionEvidence = false) {
  return { phase, file, subject, marker, decisionEvidence };
}

function buildLedger(item) {
  const regions = ['apac-north', 'apac-south', 'eu-central', 'us-east', 'us-west'];
  const services = ['identity', 'billing', 'fulfillment', 'reporting', 'archive', 'gateway'];
  const controls = ['dual-write review', 'legacy lookup', 'rollback readiness', 'retention audit'];
  const lines = [
    `# Compliance audit ledger: ${item.subject}`,
    '',
    `Ledger section ${item.file.replace('.md', '')} was attached for the Phase ${item.phase} business review.`,
    'It contains read-only operational evidence collected from regional service owners.',
    'Review the complete section independently so ownership, retention, and account samples remain traceable.',
    '',
  ];
  if (item.decisionEvidence) {
    lines.push(
      'AUDIT_FINDING: vendor compatibility code R7 was issued for region apac, and legacy ID',
      'stability remains mandatory. Derive the final configuration from the approved migration map.',
      '',
    );
  }
  const entryCount = item.phase >= 3 ? 67 : 84;
  for (let entry = 1; entry <= entryCount; entry++) {
    const serial = String(entry).padStart(4, '0');
    const seed = item.phase * 1000 + Number(item.file.match(/(\d{3})/)?.[1] ?? 0);
    const checksum = ((seed * 2_654_435_761 + entry * 97_531) >>> 0)
      .toString(16).padStart(8, '0');
    const service = services[(entry + seed) % services.length];
    const region = regions[(entry * 3 + seed) % regions.length];
    const control = controls[(entry * 5 + seed) % controls.length];
    lines.push(
      `LEDGER-P${item.phase}-${serial} | case=CHG-${seed}-${serial} | owner=${service}-ops-${serial} | ` +
      `region=${region} | control=${control} | legacyAccount=acct_${String(seed * 1000 + entry).padStart(8, '0')} | ` +
      `retention=${90 + (entry % 275)}d | evidence=reviewed-by-compliance-${serial} | checksum=${checksum}`,
    );
  }
  if (item.marker) lines.push('', `CONTROL_MARKER: ${item.marker}`);
  lines.push('');
  return lines.join('\n');
}
