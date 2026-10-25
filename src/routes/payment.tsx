import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  QrCode,
  Loader2,
  Crown,
  Check,
  Clock,
  X,
  Copy,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { PLANS, type Plan, planFromAmount } from "@/lib/plans";
import { createPaymentQR, checkPaymentStatus, parseAmount } from "@/lib/jvix";
import { generateOnePayDynamicQR } from "@/lib/onepay";

export const Route = createFileRoute("/payment")({
  head: () => ({ meta: [{ title: "ຊຳລະເງິນອັດຕະໂນມັດ — Lao Karaoke" }] }),
  component: PaymentPage,
});

interface PaymentReq {
  id: string;
  plan_label: string;
  amount: number;
  status: string;
  admin_note: string | null;
  created_at: string;
}

const CREDITED_STORAGE_KEY = "kb:credited_txs";

function isAlreadyCredited(txId: string): boolean {
  try {
    const raw = localStorage.getItem(CREDITED_STORAGE_KEY) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(txId);
  } catch {
    return false;
  }
}

function markAsCredited(txId: string): void {
  try {
    const raw = localStorage.getItem(CREDITED_STORAGE_KEY) || "[]";
    const arr: string[] = JSON.parse(raw);
    if (!arr.includes(txId)) {
      arr.push(txId);
      localStorage.setItem(CREDITED_STORAGE_KEY, JSON.stringify(arr.slice(-100)));
    }
  } catch {
    // Ignore storage errors
  }
}

export function PaymentPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>(PLANS[0]);
  const [loadingQR, setLoadingQR] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [displayAmount, setDisplayAmount] = useState<string>("5,000");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "pending" | "paid" | "expired">(
    "idle",
  );
  const [checking, setChecking] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [myRequests, setMyRequests] = useState<PaymentReq[]>([]);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  const loadRequests = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("payment_requests")
      .select("id, plan_label, amount, status, admin_note, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setMyRequests(data as PaymentReq[]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const uid = data.session.user.id;
      setUserId(uid);
      void loadRequests(uid);
    });
  }, [loadRequests]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // Request QR code from Jvix API
  const requestQR = useCallback(
    async (targetPlan: Plan) => {
      setLoadingQR(true);
      setPaymentStatus("pending");
      setTimeLeft(300);
      setDisplayAmount(targetPlan.price.toLocaleString());

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

      try {
        const { data: s } = await supabase.auth.getSession();
        const currentUid = s.session?.user.id || userId;

        // POST https://jvix.xyz/api/v1/oneplay/generate
        const res = await createPaymentQR(targetPlan.price);

        let finalQrUrl = "";
        let finalPayload = "";
        let txId = "";

        if (res.ok && res.qrUrl && res.transactionId) {
          finalQrUrl = res.qrUrl;
          finalPayload = res.payload || "";
          txId = res.transactionId;
          if (res.amount) setDisplayAmount(res.amount);
        } else {
          // Dynamic fallback if offline
          const fallback = generateOnePayDynamicQR(targetPlan.price);
          finalQrUrl = fallback.qrCodeUrl;
          finalPayload = fallback.raw;
          txId = `TX-${Date.now().toString(36)}`;
        }

        setQrUrl(finalQrUrl);
        setQrPayload(finalPayload);
        setTransactionId(txId);

        // Record in payment_requests table
        if (currentUid) {
          const { data: reqData, error: reqErr } = await supabase
            .from("payment_requests")
            .insert({
              user_id: currentUid,
              amount: targetPlan.price,
              plan_label: targetPlan.label,
              credits: targetPlan.credits ?? 0,
              premium_days: targetPlan.days ?? 0,
            })
            .select("id")
            .maybeSingle();

          if (!reqErr && reqData) {
            setRequestId(reqData.id);
            void loadRequests(currentUid);
          }
        }

        // Countdown timer
        countdownIntervalRef.current = setInterval(() => {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setPaymentStatus("expired");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        // Poll check every 3 seconds (as required)
        if (txId && !txId.startsWith("TX-")) {
          pollIntervalRef.current = setInterval(() => {
            void checkStatus(txId, targetPlan, currentUid);
          }, 3000);
        }
      } catch (err) {
        toast.error("ບໍ່ສາມາດສ້າງ QR ໄດ້ ກະລຸນາລອງໃໝ່");
      } finally {
        setLoadingQR(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, loadRequests],
  );

  useEffect(() => {
    void requestQR(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectPlan(p: Plan) {
    setPlan(p);
    void requestQR(p);
  }

  // Handle successful payment: credit according to amount_base ONCE, guard by transactionId
  const handlePaymentSuccess = useCallback(
    async (txId: string, amountBaseNum: number, currentPlan: Plan, uid?: string | null) => {
      // 1. Guard against duplicate credits using transactionId
      if (isAlreadyCredited(txId)) {
        return;
      }
      markAsCredited(txId);

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      setPaymentStatus("paid");

      const targetUid = uid || userId;
      const matchedPlan = planFromAmount(amountBaseNum) || currentPlan;

      // 2. Call oneplay_poll RPC if available in database
      try {
        await (
          supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>
        )("oneplay_poll", { p_transaction_id: txId });
      } catch {
        // Handled safely
      }

      // 3. Auto-approve payment request in Supabase
      if (requestId) {
        try {
          await supabase.rpc("admin_approve_payment", {
            p_id: requestId,
            p_note: `Auto-Verified: ${txId}`,
          });
        } catch {
          // Handled safely
        }
      }

      if (targetUid) {
        void loadRequests(targetUid);
      }

      toast.success("ຊຳລະເງິນສຳເລັດແລ້ວ!", {
        description: `ລະບົບຕັດຍອດ ແລະ ເພີ່ມ ${matchedPlan.label} ໃຫ້ຮຽບຮ້ອຍ`,
      });
    },
    [userId, requestId, loadRequests],
  );

  // Check payment status: POST https://jvix.xyz/api/v1/oneplay/check
  // status success + paid = จ่ายแล้ว | pending = โพลต่อ
  async function checkStatus(txId: string, currentPlan: Plan, uid?: string | null, manual = false) {
    if (inFlightRef.current && !manual) return;
    inFlightRef.current = true;
    if (manual) setChecking(true);

    try {
      const res = await checkPaymentStatus(txId);

      if (res.paid) {
        // Credit according to amount_base
        const baseNum = res.amountBase ? parseAmount(res.amountBase) : currentPlan.price;
        await handlePaymentSuccess(txId, baseNum || currentPlan.price, currentPlan, uid);
      } else if (res.status === "expired") {
        setPaymentStatus("expired");
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (manual) toast.error("QR Code ໝົດອາຍຸແລ້ວ ກະລຸນາກົດສ້າງໃໝ່");
      } else if (manual) {
        toast.info("ຍັງບໍ່ພົບຍອດໂອນ", {
          description: "ຫາກໂອນແລ້ວ ກະລຸນາລໍຖ້າສັກຄູ່ ລະບົບຈະກວດສອບອັດຕະໂນມັດ",
        });
      }
    } catch {
      if (manual) toast.error("ການເຊື່ອມຕໍ່ຂັດຂ້ອງ ກະລຸນາລອງໃໝ່");
    } finally {
      inFlightRef.current = false;
      if (manual) setChecking(false);
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const onePayDeepLink = qrPayload ? `onepay://qr/${qrPayload}` : null;

  return (
    <div className="min-h-screen pb-16">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70 transition"
          >
            <ArrowLeft className="w-4 h-4" /> ກັບໜ້າຫຼັກ
          </Link>
          <h1 className="text-xl font-extrabold flex items-center gap-2">
            <Crown className="w-5 h-5 text-premium" /> ຊຳລະເງິນອັດຕະໂນມັດ
          </h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 space-y-4">
        {/* Banner: เติมได้ทุกธนาคาร */}
        <div className="rounded-3xl overflow-hidden border border-border shadow-soft glass bg-white/60 dark:bg-black/30">
          <img
            src="/pay-banks.jpg"
            alt="ເຕີມໄດ້ ທຸກທະນາຄານ — BCEL One, Kasikorn, m moneyX, JDB, u-money, BFL, Lao-Viet Bank, Indochina Bank"
            className="w-full h-auto object-cover max-h-56 sm:max-h-64"
          />
          <div className="p-3 sm:p-4 bg-gradient-to-r from-emerald-500/10 via-primary/10 to-purple-500/10 flex items-center justify-center gap-2 text-xs sm:text-sm font-bold text-center">
            <Zap className="w-4 h-4 text-emerald-500 shrink-0 fill-emerald-500" />
            <span>ລະບົບຕັດຍອດອັດຕະໂນມັດ 100% · ໂອນແລ້ວລະບົບເຕີມເຄຣດິດທັນທີ ບໍ່ຕ້ອງແນບສະລິບ!</span>
          </div>
        </div>

        {/* 1. Plan Selection */}
        <div className="glass rounded-3xl p-5 border border-white/40 dark:border-white/10 shadow-soft">
          <h2 className="font-extrabold mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
              1
            </span>
            ເລືອກແພັກເກດ
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {PLANS.map((p) => {
              const active = plan.label === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => handleSelectPlan(p)}
                  aria-pressed={active}
                  className={`relative text-left p-3.5 rounded-2xl border-2 transition-all ${
                    active
                      ? "border-primary bg-primary/10 shadow-sm scale-[1.01]"
                      : "border-border hover:border-primary/40 bg-white/40 dark:bg-white/5"
                  }`}
                >
                  {active && (
                    <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                  <div className="text-xs font-bold text-muted-foreground">{p.label}</div>
                  <div className="text-base sm:text-lg font-extrabold text-primary mt-0.5">
                    {p.price.toLocaleString()} ກີບ
                  </div>
                  {p.credits && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      + {p.credits} ເຄຣດິດແປເພງ
                    </div>
                  )}
                  {p.days && (
                    <div className="text-[11px] text-premium font-semibold mt-1">
                      👑 ໃຊ້ງານບໍ່ຈຳກັດ {p.days} ວັນ
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. QR Code & Auto Payment State */}
        <div className="glass rounded-3xl p-6 border border-white/40 dark:border-white/10 shadow-soft text-center">
          <h2 className="font-extrabold mb-4 flex items-center justify-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
              2
            </span>
            ສະແກນ QR ຊຳລະເງິນ
          </h2>

          {paymentStatus === "paid" ? (
            /* PAID SUCCESS SCREEN */
            <div className="py-6 px-4 rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/40 text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/30">
                <Check className="w-9 h-9" />
              </div>
              <h3 className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                ຊຳລະເງິນສຳເລັດແລ້ວ!
              </h3>
              <p className="text-sm font-semibold mt-1 text-muted-foreground">
                ລະບົບຕັດຍອດອັດຕະໂນມັດ ແລະ ເພີ່ມ{" "}
                <span className="text-primary font-bold">{plan.label}</span> ໃຫ້ບັນຊີຂອງທ່ານແລ້ວ
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
                <Link to="/">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
                  >
                    <Sparkles className="w-4 h-4 mr-2" /> ໄປໜ້າແປເນື້ອເພງ (ໜ້າຫຼັກ)
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => requestQR(plan)}
                  className="w-full sm:w-auto font-bold"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> ເຕີມເພີ່ມອີກ
                </Button>
              </div>
            </div>
          ) : (
            /* PENDING QR DISPLAY */
            <div className="space-y-4">
              <div className="relative inline-block mx-auto bg-white p-3 sm:p-4 rounded-3xl shadow-md border">
                {loadingQR ? (
                  <div className="w-64 h-64 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-xs font-bold text-muted-foreground">ກຳລັງສ້າງ QR...</span>
                  </div>
                ) : qrUrl ? (
                  <>
                    <img
                      src={qrUrl}
                      alt="Payment QR Code"
                      className="w-64 h-64 object-contain mx-auto"
                    />
                    {paymentStatus === "expired" && (
                      <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] rounded-3xl flex flex-col items-center justify-center p-4 text-white">
                        <Clock className="w-10 h-10 text-amber-400 mb-2" />
                        <span className="font-extrabold text-sm">QR Code ໝົດອາຍຸແລ້ວ</span>
                        <Button
                          size="sm"
                          onClick={() => requestQR(plan)}
                          className="mt-3 bg-primary text-white font-bold"
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" /> ສ້າງ QR ໃໝ່
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-64 h-64 flex flex-col items-center justify-center gap-2">
                    <QrCode className="w-12 h-12 text-muted-foreground" />
                    <Button size="sm" onClick={() => requestQR(plan)}>
                      ລອງໃໝ່
                    </Button>
                  </div>
                )}
              </div>

              {/* Amount & Account Info */}
              <div>
                <div className="text-2xl sm:text-3xl font-black text-primary">
                  {displayAmount} ກີບ
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>ບັນຊີປາຍທາງ: AKAPHON XAYYABED · ທຸກທະນາຄານ</span>
                </div>
              </div>

              {/* Live Status Detector Badge */}
              <div className="rounded-2xl bg-primary/5 border border-primary/20 p-3 max-w-md mx-auto">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-primary">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span>ກຳລັງລໍຖ້າການໂອນເງິນ... ລະບົບກວດສອບອັດຕະໂນມັດ</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  ໝົດອາຍຸໃນ:{" "}
                  <span className="font-mono font-bold text-foreground">
                    {formatTime(timeLeft)}
                  </span>{" "}
                  ນາທີ
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-md mx-auto pt-1">
                {onePayDeepLink && (
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto font-bold border-primary/30 hover:bg-primary/10"
                    onClick={() => {
                      window.location.href = onePayDeepLink;
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-1.5" /> ເປີດແອັບ OnePay
                  </Button>
                )}
                <Button
                  variant="default"
                  disabled={checking || loadingQR || paymentStatus === "expired"}
                  onClick={() => {
                    if (transactionId) {
                      void checkStatus(transactionId, plan, userId, true);
                    }
                  }}
                  className="w-full sm:w-auto font-bold shadow-sm"
                >
                  {checking ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-1.5" />
                  )}
                  ກວດສອບຍອດໂອນດຽວນີ້
                </Button>
              </div>

              {transactionId && (
                <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1 pt-1">
                  <span>Ref: {transactionId.slice(-12)}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(transactionId);
                      toast.success("ສຳເນົາ Ref ແລ້ວ");
                    }}
                    className="hover:text-primary transition"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Requests History */}
        {myRequests.length > 0 && (
          <div className="glass rounded-3xl p-5 border border-white/40 dark:border-white/10 shadow-soft">
            <h2 className="font-extrabold mb-3">ປະຫວັດການຊຳລະເງິນ</h2>
            <div className="space-y-2">
              {myRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-white/40 dark:bg-white/5 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{r.plan_label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.amount.toLocaleString()} ກີບ ·{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <PaymentStatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: {
      label: "ລໍຖ້າກວດສອບ",
      cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
      icon: <Clock className="w-3 h-3" />,
    },
    approved: {
      label: "ອະນຸມັດແລ້ວ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      icon: <Check className="w-3 h-3" />,
    },
    paid: {
      label: "ຊຳລະແລ້ວ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      icon: <Check className="w-3 h-3" />,
    },
    rejected: {
      label: "ປະຕິເສດ",
      cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
      icon: <X className="w-3 h-3" />,
    },
    expired: {
      label: "ໝົດອາຍຸ",
      cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
      icon: <Clock className="w-3 h-3" />,
    },
  };
  const s = map[status] ?? {
    label: status,
    cls: "bg-muted text-muted-foreground",
    icon: null,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${s.cls}`}
    >
      {s.icon} {s.label}
    </span>
  );
}
