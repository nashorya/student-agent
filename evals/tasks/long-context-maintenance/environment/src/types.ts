export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  includedSeats: number;
  includedUsageGb: number;
  overageRatePerGb: number;
}

export interface Account {
  id: string;
  name: string;
  planId: string;
  seats: number;
  usageGb: number;
  status: "active" | "trial" | "paused";
  region: "EU" | "US" | "APAC";
}

export interface InvoiceLine {
  label: string;
  amount: number;
}

export interface Invoice {
  accountId: string;
  subtotal: number;
  tax: number;
  total: number;
  lines: InvoiceLine[];
  flags: string[];
}
