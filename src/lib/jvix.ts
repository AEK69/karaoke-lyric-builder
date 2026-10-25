// Jvix Cloud automated payment client
// Base URL: https://jvix.xyz
// Channel: OnePlay
const JVIX_API_KEY = "jvixcloud_live_e50047095b0a768aa2df96822d529a865457428738949921";
const JVIX_BASE_URL = "https://jvix.xyz";

export interface GenerateResult {
  ok: boolean;
  transactionId?: string;
  qrUrl?: string;
  payload?: string;
  amount?: string;
  amountBase?: string;
  expiresAt?: number;
  expiresIn?: number;
  error?: string;
}

export interface CheckResult {
  ok: boolean;
  status: "pending" | "paid" | "expired" | "error";
  paid: boolean;
  transactionId?: string;
  amount?: string;
  amountBase?: string;
  timeRemaining?: number;
  message?: string;
  raw?: unknown;
}

/**
 * Parses integer amount from string (e.g. "5,004" -> 5004, "5,000 LAK" -> 5000)
 */
export function parseAmount(val: unknown): number {
  if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
  if (typeof val === "string") {
    const n = Number.parseInt(val.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Generate a dynamic QR code for the given integer amount in LAK (minimum 1000)
 * POST https://jvix.xyz/api/v1/oneplay/generate
 */
export async function createPaymentQR(amountLak: number): Promise<GenerateResult> {
  const integerAmount = Math.max(1000, Math.round(amountLak));
  try {
    const res = await fetch(`${JVIX_BASE_URL}/api/v1/oneplay/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JVIX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: integerAmount }),
    });

    if (!res.ok) {
      return { ok: false, error: "ບໍ່ສາມາດເຊື່ອມຕໍ່ລະບົບຊຳລະເງິນໄດ້" };
    }

    const json = await res.json();
    if (json.status === "success" && json.data) {
      const d = json.data;
      return {
        ok: true,
        transactionId: d.transactionId,
        qrUrl: d.qr_url,
        payload: d.payload,
        amount: d.amount,
        amountBase: d.amount_base || String(integerAmount),
        expiresAt: d.expires_at ? Number(d.expires_at) * 1000 : Date.now() + 300_000,
        expiresIn: d.expires_in ?? 300,
      };
    }

    return { ok: false, error: "ບໍ່ສາມາດສ້າງ QR ໄດ້ ກະລຸນາລອງໃໝ່" };
  } catch {
    return { ok: false, error: "ການເຊື່ອມຕໍ່ຂັດຂ້ອງ ກະລຸນາກວດສອບອິນເຕີເນັດ" };
  }
}

/**
 * Check payment status by transactionId
 * POST https://jvix.xyz/api/v1/oneplay/check
 * status success + paid = จ่ายแล้ว | pending = โพลต่อ
 */
export async function checkPaymentStatus(transactionId: string): Promise<CheckResult> {
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
      return { ok: false, status: "error", paid: false, message: "ການເຊື່ອມຕໍ່ຂັດຂ້ອງ" };
    }

    const json = await res.json();
    const st = String(json.status || json.message || "").toLowerCase();
    const isPaid =
      st === "paid" ||
      json.paid === true ||
      (st === "success" &&
        (json.data?.paid === true ||
          json.paid === "true" ||
          String(json.message).toLowerCase() === "paid"));

    if (isPaid) {
      return {
        ok: true,
        status: "paid",
        paid: true,
        transactionId: json.transactionId || transactionId,
        amount: json.amount,
        amountBase: json.amount_base || json.data?.amount_base,
        raw: json,
      };
    }

    if (
      st === "expired" ||
      st === "timeout" ||
      (json.time_remaining !== undefined && json.time_remaining <= 0)
    ) {
      return {
        ok: true,
        status: "expired",
        paid: false,
        transactionId: json.transactionId || transactionId,
        raw: json,
      };
    }

    return {
      ok: true,
      status: "pending",
      paid: false,
      transactionId: json.transactionId || transactionId,
      amount: json.amount,
      amountBase: json.amount_base || json.data?.amount_base,
      timeRemaining: json.time_remaining,
      raw: json,
    };
  } catch {
    return {
      ok: false,
      status: "error",
      paid: false,
      message: "ການເຊື່ອມຕໍ່ຂັດຂ້ອງ",
    };
  }
}
