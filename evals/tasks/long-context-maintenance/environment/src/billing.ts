import { type Account, type Invoice, type Plan } from "./types.js";

export function normalizeUsage(usageGb: number): number {
  // TODO: implement
  return usageGb;
}

export function calculateInvoice(account: Account, plan: Plan): Invoice {
  // TODO: implement
  return {
    accountId: account.id,
    subtotal: 0,
    tax: 0,
    total: 0,
    lines: [],
    flags: [],
  };
}

export function summarizeAccounts(accounts: Account[], plans: Plan[]): Invoice[] {
  // TODO: implement
  return [];
}
