import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'evals/tasks/jspace-compaction-probe-01/environment/docs';
const names = ['alpha', 'beta', 'gamma'];
const regions = ['apac-north', 'apac-south', 'eu-central', 'us-east', 'us-west'];
const modes = ['legacy-stable', 'bridge-ready', 'strict-audit', 'compat-readonly'];
const owners = ['identity', 'billing', 'fulfillment', 'reporting', 'archive', 'gateway'];

await generateLedgerSet('context-ledgers', 'CONTEXT', 'Phase 1', 0);

async function generateLedgerSet(directory, markerKind, phase, idOffset) {
  const outputDir = join(root, directory);
  await mkdir(outputDir, { recursive: true });
  for (let ledgerIndex = 0; ledgerIndex < names.length; ledgerIndex++) {
  const name = names[ledgerIndex];
  const marker = `${name.toUpperCase()}-${markerKind}-VERIFIED`;
  const lines = [
    `# ${markerKind === 'CONTEXT' ? 'Historical compatibility' : 'Post-migration recovery'} ledger: ${name}`,
    '',
    'This read-only evidence ledger deliberately represents long-lived operational history.',
    `Read the complete file during ${phase}. Do not edit, summarize into a new file, or use it`,
    'to derive the Phase 2 migration decision; that decision still comes only from the vendor',
    'response and migration map. Report the control marker at the end in the Phase 1 signal.',
    '',
  ];
  // Keep every ledger below Pi's 50 KiB single-read ceiling so the marker at
  // the end is only visible after the complete file has entered the session.
  for (let entry = 1; entry <= 315; entry++) {
    const serial = String(entry).padStart(4, '0');
    const checksum = ((ledgerIndex + 11) * 2_654_435_761 + entry * 97_531)
      .toString(16).slice(-8).padStart(8, '0');
    lines.push(
      `ENTRY-${name.toUpperCase()}-${serial} | service=${owners[(entry + ledgerIndex) % owners.length]}-${serial} | ` +
      `region=${regions[(entry * 3 + ledgerIndex) % regions.length]} | ` +
      `compatibility=${modes[(entry * 5 + ledgerIndex) % modes.length]} | ` +
      `legacy-id=acct_${String(idOffset + ledgerIndex * 10_000 + entry).padStart(8, '0')} | ` +
      `retention=${30 + (entry % 335)}d | audit=${checksum}`,
    );
  }
  lines.push('', `CONTROL_MARKER: ${marker}`, '');
  await writeFile(join(outputDir, `${name}.md`), lines.join('\n'), 'utf8');
  }
}
