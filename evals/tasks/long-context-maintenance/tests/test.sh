#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

run_ts() {
  tsx "$@" 2>&1 || npx tsx "$@" 2>&1 || true
}

run_ts_eval() {
  echo "$1" | tsx - 2>&1 || echo "$1" | npx tsx - 2>&1 || true
}

for file in "src/types.ts" "src/plans.ts" "src/accounts.ts" "src/billing.ts" "src/report.ts" "src/main.ts" "docs/billing-rules.md" "docs/ops-checklist.md"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: $file not found"
    exit 1
  fi
done

billing=$(cat "src/billing.ts")
report=$(cat "src/report.ts")
main=$(cat "src/main.ts")
ops=$(cat "docs/ops-checklist.md")

for func in "normalizeUsage" "calculateInvoice" "summarizeAccounts"; do
  if ! echo "$billing" | grep -q "export function $func"; then
    echo "FAIL: export function $func not found in src/billing.ts"
    exit 1
  fi
done

if ! echo "$report" | grep -q "export function renderRenewalReport"; then
  echo "FAIL: renderRenewalReport not exported from src/report.ts"
  exit 1
fi

if ! echo "$main" | grep -q "renderRenewalReport"; then
  echo "FAIL: src/main.ts should call renderRenewalReport"
  exit 1
fi

if ! echo "$ops" | grep -Eq 'Run renewal report with `?npx tsx src/main\.ts`?'; then
  echo "FAIL: docs/ops-checklist.md missing renewal report command"
  exit 1
fi

if ! echo "$ops" | grep -q "Review overage and seats flags before sending invoices"; then
  echo "FAIL: docs/ops-checklist.md missing invoice review step"
  exit 1
fi

NORMALIZE_OUTPUT=$(run_ts_eval "
import { normalizeUsage } from './src/billing.js';

const cases = [
  [-3, 0],
  [0, 0],
  [10.01, 11],
  [620, 620],
];
for (const [input, expected] of cases) {
  const actual = normalizeUsage(input);
  if (actual !== expected) {
    console.log('FAIL: normalizeUsage expected', expected, 'for', input, 'got', actual);
    process.exit(1);
  }
}
console.log('PASS: normalizeUsage');
")

if ! echo "$NORMALIZE_OUTPUT" | grep -q "PASS: normalizeUsage"; then
  echo "FAIL: normalizeUsage logic test failed"
  echo "$NORMALIZE_OUTPUT"
  exit 1
fi

INVOICE_OUTPUT=$(run_ts_eval "
import { calculateInvoice, summarizeAccounts } from './src/billing.js';
import { accounts } from './src/accounts.js';
import { plans } from './src/plans.js';

const byName = Object.fromEntries(accounts.map((account) => [account.name, account]));
const byId = Object.fromEntries(plans.map((plan) => [plan.id, plan]));

const acme = calculateInvoice(byName['Acme Co'], byId.pro);
if (acme.subtotal !== 133 || acme.tax !== 26.6 || acme.total !== 159.6) {
  console.log('FAIL: Acme invoice mismatch', JSON.stringify(acme));
  process.exit(1);
}
if (!acme.flags.includes('overage') || !acme.flags.includes('seats')) {
  console.log('FAIL: Acme invoice missing flags', acme.flags.join(','));
  process.exit(1);
}

const beta = calculateInvoice(byName['Beta Studio'], byId.starter);
if (beta.subtotal !== 14.5 || beta.tax !== 1.16 || beta.total !== 15.66) {
  console.log('FAIL: Beta trial invoice mismatch', JSON.stringify(beta));
  process.exit(1);
}
if (!beta.flags.includes('trial')) {
  console.log('FAIL: Beta invoice missing trial flag', beta.flags.join(','));
  process.exit(1);
}

const cobalt = calculateInvoice(byName['Cobalt Labs'], byId.enterprise);
if (cobalt.subtotal !== 379 || cobalt.tax !== 30.32 || cobalt.total !== 409.32) {
  console.log('FAIL: Cobalt invoice mismatch', JSON.stringify(cobalt));
  process.exit(1);
}

const delta = calculateInvoice(byName['Delta Works'], byId.pro);
if (delta.total !== 0 || !delta.flags.includes('paused')) {
  console.log('FAIL: Delta paused invoice mismatch', JSON.stringify(delta));
  process.exit(1);
}

const summaries = summarizeAccounts(accounts, plans);
if (summaries.length !== 3 || summaries.some((invoice) => invoice.accountId === 'acct_delta')) {
  console.log('FAIL: summarizeAccounts should include exactly 3 non-paused invoices', JSON.stringify(summaries));
  process.exit(1);
}
console.log('PASS: invoices');
")

if ! echo "$INVOICE_OUTPUT" | grep -q "PASS: invoices"; then
  echo "FAIL: invoice logic test failed"
  echo "$INVOICE_OUTPUT"
  exit 1
fi

REPORT_OUTPUT=$(run_ts "src/main.ts")

for expected in \
  "Renewal Report" \
  "- Acme Co: Pro - ¥159.60 (overage,seats)" \
  "- Beta Studio: Starter - ¥15.66 (trial)" \
  "- Cobalt Labs: Enterprise - ¥409.32 (overage,seats)" \
  "Grand total: ¥584.58" \
  "At-risk accounts: Acme Co, Cobalt Labs"; do
  if ! echo "$REPORT_OUTPUT" | grep -q -- "$expected"; then
    echo "FAIL: report output missing: $expected"
    echo "--- output ---"
    echo "$REPORT_OUTPUT"
    exit 1
  fi
done

if echo "$REPORT_OUTPUT" | grep -q "Delta Works"; then
  echo "FAIL: paused account Delta Works should not appear in report"
  echo "--- output ---"
  echo "$REPORT_OUTPUT"
  exit 1
fi

printf '1\n' > "$REWARD_FILE"
echo "PASS: all long-context maintenance checks passed"
