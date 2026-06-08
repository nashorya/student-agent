import { summarizeAccounts } from "./billing.js";
import { type Account, type Plan } from "./types.js";

export function renderRenewalReport(accounts: Account[], plans: Plan[]): string {
  // TODO: implement
  summarizeAccounts(accounts, plans);
  return "Renewal Report";
}
