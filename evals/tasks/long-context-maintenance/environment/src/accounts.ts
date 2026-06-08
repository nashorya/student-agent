import { type Account } from "./types.js";

export const accounts: Account[] = [
  {
    id: "acct_acme",
    name: "Acme Co",
    planId: "pro",
    seats: 12,
    usageGb: 620,
    status: "active",
    region: "EU",
  },
  {
    id: "acct_beta",
    name: "Beta Studio",
    planId: "starter",
    seats: 2,
    usageGb: 80,
    status: "trial",
    region: "US",
  },
  {
    id: "acct_cobalt",
    name: "Cobalt Labs",
    planId: "enterprise",
    seats: 55,
    usageGb: 2500,
    status: "active",
    region: "US",
  },
  {
    id: "acct_delta",
    name: "Delta Works",
    planId: "pro",
    seats: 8,
    usageGb: 400,
    status: "paused",
    region: "APAC",
  },
];
