import { type Plan } from "./types.js";

export const plans: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 29,
    includedSeats: 3,
    includedUsageGb: 100,
    overageRatePerGb: 0.2,
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 99,
    includedSeats: 10,
    includedUsageGb: 500,
    overageRatePerGb: 0.15,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: 299,
    includedSeats: 50,
    includedUsageGb: 2000,
    overageRatePerGb: 0.08,
  },
];
