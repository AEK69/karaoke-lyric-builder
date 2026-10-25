export interface Plan {
  label: string;
  price: number;
  days?: number;
  credits?: number;
  custom?: boolean;
}

/** 250 LAK per credit (base rate) */
export const CREDIT_RATE = 250;

/** Minimum custom credits */
export const MIN_CUSTOM_CREDITS = 4;

export const PLANS: Plan[] = [
  { label: "20 ເຄຣດິດ", price: 5000, credits: 20 },
  { label: "60 ເຄຣດິດ", price: 10000, credits: 60 },
  { label: "Premium 1 ເດືອນ", price: 30000, days: 30 },
  { label: "Premium 1 ປີ", price: 300000, days: 365 },
];

export const PAY_WINDOW_SECONDS = 300;

export function parseLakAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function planFromLabel(label: string): Plan | undefined {
  return PLANS.find((p) => p.label === label);
}

export function planFromAmount(amount: number): Plan | undefined {
  return PLANS.find((p) => p.price === amount);
}

/** Create a custom-credit plan from a user-specified credit count */
export function customCreditPlan(credits: number): Plan {
  const c = Math.max(MIN_CUSTOM_CREDITS, Math.round(credits));
  const price = Math.max(1000, c * CREDIT_RATE);
  return { label: `${c} ເຄຣດິດ`, price, credits: c, custom: true };
}
