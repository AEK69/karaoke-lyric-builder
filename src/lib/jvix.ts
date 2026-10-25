// Jvix Cloud OnePlay automated payment client
const JVIX_API_KEY = "jvixcloud_live_e50047095b0a768aa2df96822d529a865457428738949921";
const JVIX_BASE_URL = "https://jvix.xyz";

export interface OnePlayGenerateResult {
  ok: boolean;
  transactionId?: string;
  qrUrl?: string;
  payload?: string;
  amount?: string | number;
  expiresAt?: number;
  expiresIn?: number;
  error?: string;
}

export interface OnePlayCheckResult {
  ok: boolean;
  status: "pending" | "paid" | "expired" | "error";
  transactionId?: string;
  amount?: string | number;
  timeRemaining?: number;
  message?: string;
  raw?: unknown;
}

/**
 * Generate a dynamic OnePlay QR for the given amount (in LAK)
 */
export async function generateOnePlayQR(amount: number): Promise<OnePlayGenerateResult> {
  try {
    const res = await fetch(`${JVIX_BASE_URL}/api/v1/oneplay/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JVIX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.status === "success" && data.data) {
      const d = data.data;
      return {
        ok: true,
        transactionId: d.transactionId,
        qrUrl: d.qr_url,
        payload: d.payload,
        amount: d.amount,
        expiresAt: d.expires_at ? Number(d.expires_at) * 1000 : Date.now() + 300_000,
        expiresIn: d.expires_in ?? 300,
      };
    }

    return { ok: false, error: data.message || "Failed to generate OnePlay QR" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check payment status for a OnePlay transactionId
 */
export async function checkOnePlayPayment(transactionId: string): Promise<OnePlayCheckResult> {
  try {
    const res = await fetch(`${JVIX_BASE_URL}/api/v1/oneplay/check`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JVIX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transactionId }),
    });

    if (!res.ok) {
      return { ok: false, status: "error", message: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const st = String(data.status || data.message || "").toLowerCase();

    if (st === "paid" || data.paid === true || data.data?.status === "paid") {
      return {
        ok: true,
        status: "paid",
        transactionId: data.transactionId || transactionId,
        amount: data.amount,
        raw: data,
      };
    }

    if (
      st === "expired" ||
      st === "timeout" ||
      (data.time_remaining !== undefined && data.time_remaining <= 0)
    ) {
      return {
        ok: true,
        status: "expired",
        transactionId: data.transactionId || transactionId,
        raw: data,
      };
    }

    return {
      ok: true,
      status: "pending",
      transactionId: data.transactionId || transactionId,
      amount: data.amount,
      timeRemaining: data.time_remaining,
      raw: data,
    };
  } catch (e) {
    return {
      ok: false,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
