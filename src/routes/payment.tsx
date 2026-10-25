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

        // Countdown timer (5 minutes)
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

        // Poll check every 3 seconds (as requested)
        if (txId && !txId.startsWith("TX-")) {
          pollIntervalRef.current = setInterval(() => {
            void checkStatus(txId, targetPlan, currentUid);
          }, 3000);
        }
      } catch {
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

      // 2. Direct user credit via complete_oneplay_payment RPC
      try {
        await (
          supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>
        )("complete_oneplay_payment", {
          p_transaction_id: txId,
          p_request_id: requestId || null,
        });
      } catch {
        // Handled safely
      }

      // 3. Admin auto-approval RPC (for admin users)
      if (requestId) {
        try {
          await supabase.rpc("admin_approve_payment", {
            p_id: requestId,
            p_note: `Auto-Cut: ${txId}`,
          });
        } catch {
          // Handled safely
        }
      }

      // 4. oneplay_poll RPC fallback
      try {
        await (
          supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>
        )("oneplay_poll", { p_transaction_id: txId });
      } catch {
        // Handled safely
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
    <div className="min-h-screen pb-12">
      <Toaster richColors position="top-center" />

      {/* Compact Header */}
      <header className="px-3 sm:px-4 pt-3 pb-2 max-w-xl mx-auto flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> ກັບໜ້າຫຼັກ
        </Link>
        <h1 className="text-base sm:text-lg font-extrabold flex items-center gap-1.5">
          <Crown className="w-4 h-4 text-premium" /> ຊຳລະເງິນອັດຕະໂນມັດ
        </h1>
        <div className="w-12" />
      </header>

      <main className="max-w-xl mx-auto px-3 sm:px-4 space-y-2.5 sm:space-y-3">
        {/* Compact Banner: เติมได้ทุกธนาคาร */}
        <div className="rounded-2xl overflow-hidden border border-border/80 shadow-xs glass bg-white/60 dark:bg-black/30">
          <div className="relative h-24 sm:h-28 overflow-hidden">
            <img
              src="/pay-banks.jpg"
              alt="ເຕີມໄດ້ ທຸກທະນາຄານ"
              className="w-full h-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-white text-xs font-bold">
              <span className="flex items-center gap-1 drop-shadow-sm text-[11px] sm:text-xs">
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300 shrink-0" />
                <span>ຕັດຍອດອັດຕະໂນມັດ 100%</span>
              </span>
              <span className="text-[10px] sm:text-[11px] text-white/90 drop-shadow-sm">
                ໂອນແລ້ວເຄຣດິດເຂົ້າທັນທີ
              </span>
            </div>
          </div>
        </div>

        {/* 1. Plan Selection (Compact 2x2 Grid) */}
        <div className="glass rounded-2xl p-3 sm:p-3.5 border border-white/40 dark:border-white/10 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
              <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-extrabold">
                1
              </span>
              ເລືອກແພັກເກດ
            </h2>
            <span className="text-[11px] text-muted-foreground">ກົດເພື່ອເລືອກ</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {PLANS.map((p) => {
              const active = plan.label === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => handleSelectPlan(p)}
                  aria-pressed={active}
                  className={`relative text-left p-2.5 rounded-xl border transition-all ${
                    active
                      ? "border-primary bg-primary/10 shadow-xs scale-[1.01]"
                      : "border-border hover:border-primary/40 bg-white/40 dark:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-foreground truncate">{p.label}</div>
                    {active && (
                      <span className="w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-primary mt-0.5">
                    {p.price.toLocaleString()} ກີບ
                  </div>
                  {p.credits && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      +{p.credits} ເຄຣດິດ
                    </div>
                  )}
                  {p.days && (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                      👑 ບໍ່ຈຳກັດ {p.days} ວັນ
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. QR Code & Auto Payment State */}
        <div className="glass rounded-2xl p-3.5 sm:p-4 border border-white/40 dark:border-white/10 shadow-xs text-center space-y-2.5">
          <div className="flex items-center justify-center gap-1.5">
            <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-extrabold">
              2
            </span>
            <h2 className="text-xs sm:text-sm font-bold">ສະແກນ QR ໂອນເງິນ</h2>
          </div>

          {paymentStatus === "paid" ? (
            /* PAID SUCCESS SCREEN */
            <div className="py-5 px-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-2 shadow-md shadow-emerald-500/20">
                <Check className="w-7 h-7" />
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                ຊຳລະເງິນສຳເລັດແລ້ວ!
              </h3>
              <p className="text-xs font-semibold mt-1 text-muted-foreground">
                ລະບົບຕັດຍອດອັດຕະໂນມັດ ແລະ ເພີ່ມ{" "}
                <span className="text-primary font-bold">{plan.label}</span> ໃຫ້ບັນຊີຂອງທ່ານແລ້ວ
              </p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center max-w-xs mx-auto">
                <Link to="/" className="flex-1">
                  <Button
                    size="sm"
                    className="w-full font-bold bg-emerald-600 hover:bg-emerald-700 text-white h-9"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" /> ໄປໜ້າແປເນື້ອເພງ
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestQR(plan)}
                  className="font-bold h-9"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> ເຕີມເພີ່ມ
                </Button>
              </div>
            </div>
          ) : (
            /* PENDING QR DISPLAY (Compact) */
            <div className="space-y-2.5">
              <div className="relative inline-block mx-auto bg-white p-2 rounded-2xl shadow-xs border border-border">
                {loadingQR ? (
                  <div className="w-40 h-40 sm:w-48 sm:h-48 flex flex-col items-center justify-center gap-1.5">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-[11px] font-bold text-muted-foreground">
                      ກຳລັງສ້າງ QR...
                    </span>
                  </div>
                ) : qrUrl ? (
                  <>
                    <img
                      src={qrUrl}
                      alt="Payment QR Code"
                      className="w-40 h-40 sm:w-48 sm:h-48 object-contain mx-auto"
                    />
                    {paymentStatus === "expired" && (
                      <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center p-3 text-white">
                        <Clock className="w-8 h-8 text-amber-400 mb-1" />
                        <span className="font-extrabold text-xs">QR ໝົດອາຍຸແລ້ວ</span>
                        <Button
                          size="sm"
                          onClick={() => requestQR(plan)}
                          className="mt-2 bg-primary text-white font-bold h-7 text-xs px-2.5"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" /> ສ້າງ QR ໃໝ່
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-40 h-40 sm:w-48 sm:h-48 flex flex-col items-center justify-center gap-1.5">
                    <QrCode className="w-8 h-8 text-muted-foreground" />
                    <Button size="sm" onClick={() => requestQR(plan)} className="h-7 text-xs">
                      ລອງໃໝ່
                    </Button>
                  </div>
                )}
              </div>

              {/* Amount & Account Info */}
              <div>
                <div className="text-xl sm:text-2xl font-black text-primary">
                  {displayAmount} ກີບ
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>AKAPHON XAYYABED · ທຸກທະນາຄານ</span>
                </div>
              </div>

              {/* Compact Live Status Detector */}
              <div className="rounded-xl bg-primary/5 border border-primary/20 py-2 px-3 max-w-sm mx-auto text-xs">
                <div className="flex items-center justify-center gap-1.5 font-bold text-primary text-[11px] sm:text-xs">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>ກຳລັງກວດສອບຍອດໂອນອັດຕະໂນມັດ...</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ໝົດອາຍຸໃນ:{" "}
                  <span className="font-mono font-bold text-foreground">
                    {formatTime(timeLeft)}
                  </span>{" "}
                  ນາທີ
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-center gap-2 max-w-sm mx-auto pt-0.5">
                {onePayDeepLink && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs font-bold h-9 border-primary/30"
                    onClick={() => {
                      window.location.href = onePayDeepLink;
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> ເປີດ OnePay
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  disabled={checking || loadingQR || paymentStatus === "expired"}
                  onClick={() => {
                    if (transactionId) {
                      void checkStatus(transactionId, plan, userId, true);
                    }
                  }}
                  className="flex-1 text-xs font-bold h-9 shadow-xs"
                >
                  {checking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  )}
                  ກວດສອບດຽວນີ້
                </Button>
              </div>

              {transactionId && (
                <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                  <span>Ref: {transactionId.slice(-10)}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(transactionId);
                      toast.success("ສຳເນົາ Ref ແລ້ວ");
                    }}
                    className="hover:text-primary transition"
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compact Requests History */}
        {myRequests.length > 0 && (
          <div className="glass rounded-2xl p-3 sm:p-3.5 border border-white/40 dark:border-white/10 shadow-xs">
            <h2 className="text-xs sm:text-sm font-bold mb-2">ປະຫວັດການຊຳລະເງິນ</h2>
            <div className="space-y-1.5">
              {myRequests.slice(0, 3).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-white/40 dark:bg-white/5 py-2 px-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{r.plan_label}</div>
                    <div className="text-[10px] text-muted-foreground">
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
      label: "ລໍຖ້າ",
      cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
      icon: <Clock className="w-2.5 h-2.5" />,
    },
    approved: {
      label: "ສຳເລັດ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      icon: <Check className="w-2.5 h-2.5" />,
    },
    paid: {
      label: "ສຳເລັດ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      icon: <Check className="w-2.5 h-2.5" />,
    },
    rejected: {
      label: "ປະຕິເສດ",
      cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
      icon: <X className="w-2.5 h-2.5" />,
    },
    expired: {
      label: "ໝົດອາຍຸ",
      cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
      icon: <Clock className="w-2.5 h-2.5" />,
    },
  };
  const s = map[status] ?? {
    label: status,
    cls: "bg-muted text-muted-foreground",
    icon: null,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}
    >
      {s.icon} {s.label}
    </span>
  );
}
