#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

cat > src/billing.ts <<'BILLING'
import { type Account, type Invoice, type InvoiceLine, type Plan } from "./types.js";

const TAX_RATES: Record<Account["region"], number> = {
  EU: 0.2,
  US: 0.08,
  APAC: 0.1,
};

export function normalizeUsage(usageGb: number): number {
  return Math.max(0, Math.ceil(usageGb));
}

export function calculateInvoice(account: Account, plan: Plan): Invoice {
  if (account.status === "paused") {
    return {
      accountId: account.id,
      subtotal: 0,
      tax: 0,
      total: 0,
      lines: [],
      flags: ["paused"],
    };
  }

  const lines: InvoiceLine[] = [
    { label: `${plan.name} base`, amount: plan.monthlyPrice },
  ];
  const flags: string[] = [];

  const extraSeats = Math.max(0, account.seats - plan.includedSeats);
  if (extraSeats > 0) {
    lines.push({ label: "Extra seats", amount: extraSeats * 8 });
    flags.push("seats");
  }

  const billableUsage = normalizeUsage(account.usageGb);
  const overageGb = Math.max(0, billableUsage - plan.includedUsageGb);
  if (overageGb > 0) {
    lines.push({ label: "Usage overage", amount: overageGb * plan.overageRatePerGb });
    flags.push("overage");
  }

  if (account.status === "trial") {
    const preDiscountSubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    lines.push({ label: "Trial discount", amount: -preDiscountSubtotal * 0.5 });
    flags.push("trial");
  }

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const tax = roundMoney(subtotal * TAX_RATES[account.region]);
  const total = roundMoney(subtotal + tax);

  return {
    accountId: account.id,
    subtotal,
    tax,
    total,
    lines,
    flags,
  };
}

export function summarizeAccounts(accounts: Account[], plans: Plan[]): Invoice[] {
  return accounts.flatMap((account) => {
    if (account.status === "paused") return [];
    const plan = plans.find((candidate) => candidate.id === account.planId);
    return plan ? [calculateInvoice(account, plan)] : [];
  });
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
BILLING

cat > src/report.ts <<'REPORT'
import { summarizeAccounts } from "./billing.js";
import { type Account, type Plan } from "./types.js";

export function renderRenewalReport(accounts: Account[], plans: Plan[]): string {
  const invoices = summarizeAccounts(accounts, plans);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const lines = ["Renewal Report"];

  for (const invoice of invoices) {
    const account = accountById.get(invoice.accountId);
    if (!account) continue;
    const plan = planById.get(account.planId);
    if (!plan) continue;
    lines.push(`- ${account.name}: ${plan.name} - ¥${formatMoney(invoice.total)} (${formatFlags(invoice.flags)})`);
  }

  const grandTotal = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const atRiskAccounts = invoices
    .filter((invoice) => invoice.flags.includes("overage") || invoice.flags.includes("seats"))
    .map((invoice) => accountById.get(invoice.accountId)?.name)
    .filter((name): name is string => Boolean(name));

  lines.push(`Grand total: ¥${formatMoney(grandTotal)}`);
  lines.push(`At-risk accounts: ${atRiskAccounts.join(", ")}`);
  return lines.join("\n");
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatFlags(flags: string[]): string {
  const order = ["overage", "seats", "trial", "paused"];
  return [...flags].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(",");
}
REPORT

cat > src/main.ts <<'MAIN'
import { accounts } from "./accounts.js";
import { plans } from "./plans.js";
import { renderRenewalReport } from "./report.js";

console.log(renderRenewalReport(accounts, plans));
MAIN

cat > docs/ops-checklist.md <<'DOC'
# Ops Checklist

- Confirm account data is fresh before the renewal run.
- Run renewal report with npx tsx src/main.ts
- Review overage and seats flags before sending invoices
DOC

echo "Solution complete: long-context maintenance task implemented"
