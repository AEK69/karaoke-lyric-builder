/**
 * Client-side credit ledger & fallback sync.
 * Ensures customers always see and can use the credits they paid for,
 * even when Supabase RLS / triggers prevent direct database writes.
 */

export interface StoredPayment {
  id: string;
  plan_label: string;
  amount: number;
  credits: number;
  premium_days?: number;
  bank?: string;
  time?: string;
  status: string;
  created_at: string;
}

export function getUserPayments(uid: string): StoredPayment[] {
  if (typeof window === "undefined" || !uid) return [];
  try {
    const raw = localStorage.getItem(`kb:user_payments_${uid}`);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getPurchasedCredits(uid: string): number {
  const payments = getUserPayments(uid);
  return payments.reduce((sum, item) => {
    const isSuccess = item.status === "approved" || item.status === "paid";
    if (isSuccess && typeof item.credits === "number" && item.credits > 0) {
      return sum + item.credits;
    }
    return sum;
  }, 0);
}

export function getConsumedCredits(uid: string): number {
  if (typeof window === "undefined" || !uid) return 0;
  try {
    const raw = localStorage.getItem(`kb:user_consumed_credits_${uid}`);
    const n = Number.parseInt(raw || "0", 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  } catch {
    return 0;
  }
}

export function getLocalExtraCredits(uid: string): number {
  const purchased = getPurchasedCredits(uid);
  const consumed = getConsumedCredits(uid);
  return Math.max(0, purchased - consumed);
}

export function consumeOneLocalCredit(uid: string): number {
  if (typeof window === "undefined" || !uid) return 0;
  try {
    const current = getConsumedCredits(uid);
    const updated = current + 1;
    localStorage.setItem(`kb:user_consumed_credits_${uid}`, String(updated));
    return getLocalExtraCredits(uid);
  } catch {
    return 0;
  }
}

export function recordSuccessfulPayment(
  uid: string,
  txId: string,
  planLabel: string,
  amount: number,
  credits: number,
  premiumDays: number,
  bankSource: string,
  paidTimestamp: string,
): void {
  if (typeof window === "undefined" || !uid) return;
  try {
    const key = `kb:user_payments_${uid}`;
    const raw = localStorage.getItem(key);
    const list: StoredPayment[] = raw ? JSON.parse(raw) : [];

    const newEntry: StoredPayment = {
      id: txId,
      plan_label: planLabel,
      amount,
      credits,
      premium_days: premiumDays,
      bank: bankSource,
      time: paidTimestamp,
      status: "approved",
      created_at: new Date().toISOString(),
    };

    const filtered = list.filter((x) => x.id !== txId);
    filtered.unshift(newEntry);
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 50)));
  } catch {
    // Ignore storage errors
  }
}
