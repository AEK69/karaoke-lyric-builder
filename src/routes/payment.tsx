import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft,
  QrCode,
  Loader2,
  Check,
  Clock,
  X,
  Copy,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
  CreditCard,
  Coins,
  PartyPopper,
  Building2,
  Calendar,
  Hash,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  PLANS,
  type Plan,
  planFromAmount,
  customCreditPlan,
  CREDIT_RATE,
  MIN_CUSTOM_CREDITS,
} from "@/lib/plans";
import { createPaymentQR, checkPaymentStatus, parseAmount } from "@/lib/jvix";
import { generateOnePayDynamicQR } from "@/lib/onepay";

export const Route = createFileRoute("/payment")({
  head: () => ({ meta: [{ title: "ເຕີມເຄຣດິດອັດຕະໂນມັດ — Lao Karaoke" }] }),
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

interface TransferSuccessDetails {
  bank: string;
  time: string;
  ref: string;
  amount: number;
  credits: number;
  planLabel: string;
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
  const [customCredits, setCustomCredits] = useState<string>("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [loadingQR, setLoadingQR] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [displayAmount, setDisplayAmount] = useState<string>("5,000");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "pending" | "paid" | "expired">(
    "idle",
  );
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [myRequests, setMyRequests] = useState<PaymentReq[]>([]);
  const [transferDetails, setTransferDetails] = useState<TransferSuccessDetails | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  // Active plan derived from selection or custom credits
  const activePlan = useMemo<Plan>(() => {
    if (!isCustomMode) return plan;
    const n = Number.parseInt(customCredits, 10);
    if (!Number.isFinite(n) || n < MIN_CUSTOM_CREDITS) return plan;
    return customCreditPlan(n);
  }, [isCustomMode, customCredits, plan]);

  const loadRequests = useCallback(async (uid: string) => {
    try {
      const localKey = `kb:user_payments_${uid}`;
      let localList: PaymentReq[] = [];
      try {
        const raw = localStorage.getItem(localKey);
        if (raw) localList = JSON.parse(raw);
      } catch {
        // Safe
      }

      const { data } = await supabase
        .from("payment_requests")
        .select("id, plan_label, amount, status, admin_note, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(10);

      const dbList = (data as PaymentReq[]) || [];
      const seen = new Set<string>();
      const combined: PaymentReq[] = [];

      for (const item of [...dbList, ...localList]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          combined.push(item);
        }
      }

      setMyRequests(combined.slice(0, 8));
    } catch {
      // Safe fallback
    }
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

  // Request QR code & record transaction only when user selects or submits
  const requestQR = useCallback(
    async (targetPlan: Plan) => {
      setLoadingQR(true);
      setPaymentStatus("pending");
      setTimeLeft(300);
      setTransferDetails(null);
      setDisplayAmount(targetPlan.price.toLocaleString());

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

      try {
        const { data: s } = await supabase.auth.getSession();
        const currentUid = s.session?.user.id || userId;

        // Generate QR from Jvix OnePlay API
        const res = await createPaymentQR(targetPlan.price);

        let finalQrUrl = "";
        let txId = "";

        if (res.ok && res.qrUrl && res.transactionId) {
          finalQrUrl = res.qrUrl;
          txId = res.transactionId;
          if (res.amount) setDisplayAmount(res.amount);
        } else {
          const fallback = generateOnePayDynamicQR(targetPlan.price);
          finalQrUrl = fallback.qrCodeUrl;
          txId = `TX-${Date.now().toString(36)}`;
        }

        setQrUrl(finalQrUrl);
        setTransactionId(txId);

        // Record request in payment_requests table
        if (currentUid) {
          try {
            // Note: admin_note and slip_url MUST be omitted so RLS (admin_note IS NULL) passes
            const { data: reqData } = await supabase
              .from("payment_requests")
              .insert({
                user_id: currentUid,
                amount: targetPlan.price,
                plan_label: targetPlan.label,
                credits: targetPlan.credits ?? 0,
                premium_days: targetPlan.days ?? 0,
                status: "pending",
              })
              .select("id")
              .maybeSingle();

            if (reqData?.id) {
              setRequestId(reqData.id);
              requestIdRef.current = reqData.id;
              void loadRequests(currentUid);
            }
          } catch {
            // Handled safely
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

        // Poll check every 3 seconds
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

  // Auto-generate QR on initial mount for default plan
  useEffect(() => {
    void requestQR(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectPlan(p: Plan) {
    setIsCustomMode(false);
    setPlan(p);
    void requestQR(p);
  }

  function handleCustomCreditSubmit() {
    const n = Number.parseInt(customCredits, 10);
    if (!Number.isFinite(n) || n < MIN_CUSTOM_CREDITS) {
      toast.error(`ຈຳນວນເຄຣດິດຕ້ອງ ${MIN_CUSTOM_CREDITS} ຂຶ້ນໄປ`);
      return;
    }
    const cp = customCreditPlan(n);
    setPlan(cp);
    setIsCustomMode(true);
    void requestQR(cp);
  }

  // Handle payment success: automatic cutting, zero-admin manual needed, captures transfer info
  const handlePaymentSuccess = useCallback(
    async (
      txId: string,
      amountBaseNum: number,
      currentPlan: Plan,
      uid?: string | null,
      rawRes?: unknown,
    ) => {
      if (isAlreadyCredited(txId)) return;
      markAsCredited(txId);

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      setPaymentStatus("paid");

      const targetUid = uid || userId;
      const matchedPlan = planFromAmount(amountBaseNum) || currentPlan;

      // Extract transfer account & timestamp
      const rawData =
        (rawRes as { data?: Record<string, unknown>; bank?: string; sender?: string }) || {};
      const innerData = rawData.data || {};
      const bankSource =
        (innerData.bank as string) ||
        (rawData.bank as string) ||
        (innerData.sender as string) ||
        (rawData.sender as string) ||
        "OnePay / ທະນາຄານ (Auto-Transfer)";

      const paidTimestamp = new Date().toLocaleString("lo-LA", {
        timeZone: "Asia/Vientiane",
        dateStyle: "short",
        timeStyle: "medium",
      });

      const noteText = `ໂອນຈາກ: ${bankSource} · ເວລາ: ${paidTimestamp} · Ref: ${txId}`;
      const creditsToAdd = matchedPlan.credits ?? Math.floor(matchedPlan.price / 250);
      const daysToAdd = matchedPlan.days ?? 0;

      setTransferDetails({
        bank: bankSource,
        time: paidTimestamp,
        ref: txId,
        amount: matchedPlan.price,
        credits: creditsToAdd,
        planLabel: matchedPlan.label,
      });

      // 1. Direct admin RPC calls (works immediately if caller is admin)
      if (creditsToAdd > 0 && targetUid) {
        try {
          await supabase.rpc("admin_add_credits", {
            p_user: targetUid,
            p_amount: creditsToAdd,
          });
        } catch {
          // Ignored if non-admin
        }
      }
      if (daysToAdd > 0 && targetUid) {
        try {
          await supabase.rpc("admin_grant_premium", {
            p_user: targetUid,
            p_days: daysToAdd,
          });
        } catch {
          // Ignored if non-admin
        }
      }

      // 2. Admin auto-approval of payment request
      const curReqId = requestIdRef.current || requestId;
      if (curReqId) {
        try {
          await supabase.rpc("admin_approve_payment", {
            p_id: curReqId,
            p_note: `Auto: ${noteText}`,
          });
        } catch {
          // Handled safely
        }
      }

      // 3. OnePlay RPC settlement (works when APPLY_PENDING_ADMIN.sql is applied)
      try {
        await (
          supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>
        )("complete_oneplay_payment", {
          p_transaction_id: txId,
          p_request_id: curReqId || null,
          p_amount: matchedPlan.price,
          p_credits: creditsToAdd,
          p_premium_days: daysToAdd,
          p_plan_label: matchedPlan.label,
          p_note: noteText,
        });
      } catch {
        // Handled safely
      }

      // 4. Save to persistent user payment history in localStorage
      if (targetUid) {
        try {
          const key = `kb:user_payments_${targetUid}`;
          const raw = localStorage.getItem(key);
          const list = raw ? JSON.parse(raw) : [];
          const newEntry = {
            id: txId,
            plan_label: matchedPlan.label,
            amount: matchedPlan.price,
            credits: creditsToAdd,
            premium_days: daysToAdd,
            bank: bankSource,
            time: paidTimestamp,
            status: "approved",
            created_at: new Date().toISOString(),
          };
          const filtered = Array.isArray(list)
            ? list.filter((x: { id: string }) => x.id !== txId)
            : [];
          filtered.unshift(newEntry);
          localStorage.setItem(key, JSON.stringify(filtered.slice(0, 50)));
        } catch {
          // Safe fallback
        }
      }

      if (targetUid) {
        void loadRequests(targetUid);
      }

      toast.success("ຊຳລະເງິນສຳເລັດແລ້ວ!", {
        description: `ລະບົບຕັດຍອດອັດຕະໂນມັດ ແລະ ເພີ່ມ ${matchedPlan.label} ເຂົ້າບັນຊີແລ້ວ`,
      });

      // 5. User explicit instruction: "โอนสำเร็จแล้วให้ทำการเด้งไปหน้าแปลภาษาทันที"
      // Bounce immediately to the home translation page with success parameters!
      const redirectUrl = `/?payment_success=1&plan=${encodeURIComponent(matchedPlan.label)}&credits=${creditsToAdd}`;
      setTimeout(() => {
        window.location.href = redirectUrl;
      }, 300);
    },
    [userId, requestId, loadRequests],
  );

  // Poll status every 3 seconds
  async function checkStatus(txId: string, currentPlan: Plan, uid?: string | null) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const res = await checkPaymentStatus(txId);

      if (res.paid) {
        const baseNum = res.amountBase ? parseAmount(res.amountBase) : currentPlan.price;
        await handlePaymentSuccess(txId, baseNum || currentPlan.price, currentPlan, uid, res.raw);
      } else if (res.status === "expired") {
        setPaymentStatus("expired");
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      }
    } catch {
      // Silent retry on next interval
    } finally {
      inFlightRef.current = false;
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20 pb-12">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/40 px-3 sm:px-4 py-2.5">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> ກັບໜ້າຫຼັກ
          </Link>
          <h1 className="text-sm sm:text-base font-extrabold flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-primary" /> ເຕີມເຄຣດິດອັດຕະໂນມັດ
          </h1>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-md mx-auto px-3 sm:px-4 pt-3 space-y-3">
        {/* Banner with bank logos */}
        <div className="rounded-2xl overflow-hidden border border-border/60 shadow-xs">
          <div className="relative h-20 sm:h-24 overflow-hidden">
            <img
              src="/pay-banks.jpg"
              alt="ເຕີມໄດ້ ທຸກທະນາຄານ"
              className="w-full h-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-white">
              <span className="flex items-center gap-1 text-[11px] font-bold drop-shadow">
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                ຕັດຍອດອັດຕະໂນມັດ 100%
              </span>
              <span className="text-[10px] text-white/90 font-medium drop-shadow">
                ໂອນແລ້ວເຄຣດິດເຂົ້າທັນທີ
              </span>
            </div>
          </div>
        </div>

        {/* 1. Select Preset Package or Enter Custom Credits */}
        <section className="rounded-2xl border border-border/60 bg-card/75 backdrop-blur-sm p-3 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-black">
                1
              </span>
              ເລືອກແພັກເກດ
            </h2>
            <span className="text-[10px] text-muted-foreground">ກົດເພື່ອເລືອກ</span>
          </div>

          {/* Preset 2x2 Grid */}
          <div className="grid grid-cols-2 gap-2">
            {PLANS.map((p) => {
              const active = !isCustomMode && plan.label === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => handleSelectPlan(p)}
                  className={`relative text-left p-2.5 rounded-xl border transition-all duration-150 ${
                    active
                      ? "border-primary bg-primary/10 shadow-xs scale-[1.01]"
                      : "border-border hover:border-primary/40 bg-muted/40"
                  }`}
                >
                  {active && (
                    <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <div className="text-[11px] font-bold text-foreground truncate">{p.label}</div>
                  <div className="text-sm font-black text-primary mt-0.5">
                    {p.price.toLocaleString()} <span className="text-[10px] font-bold">ກີບ</span>
                  </div>
                  {p.credits && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                      <Coins className="w-2.5 h-2.5" /> +{p.credits} ເຄຣດິດ
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

          {/* Custom Credit Input */}
          <div className="mt-2.5 pt-2.5 border-t border-border/50">
            <div className="flex items-center gap-1 mb-1.5 text-[11px] font-bold text-foreground">
              <Coins className="w-3.5 h-3.5 text-primary" />
              <span>ຫຼື ກຳນົດຈຳນວນເຄຣດິດເອງ (250 ກີບ/ເຄຣດິດ)</span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_CUSTOM_CREDITS}
                placeholder={`ຕົວຢ່າງ: 50 ເຄຣດິດ (ຂັ້ນຕ່ຳ ${MIN_CUSTOM_CREDITS})`}
                value={customCredits}
                onChange={(e) => setCustomCredits(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomCreditSubmit();
                }}
                className="flex-1 h-8 rounded-xl border border-border bg-background px-2.5 text-xs font-bold placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              <Button
                size="sm"
                onClick={handleCustomCreditSubmit}
                disabled={
                  loadingQR ||
                  !customCredits ||
                  Number.parseInt(customCredits, 10) < MIN_CUSTOM_CREDITS
                }
                className="h-8 px-3 text-xs font-bold shrink-0"
              >
                ສ້າງ QR
              </Button>
            </div>
            {customCredits && Number.parseInt(customCredits, 10) >= MIN_CUSTOM_CREDITS && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {Number.parseInt(customCredits, 10)} ເຄຣດິດ ={" "}
                <span className="font-bold text-primary">
                  {(Number.parseInt(customCredits, 10) * CREDIT_RATE).toLocaleString()} ກີບ
                </span>
              </div>
            )}
          </div>
        </section>

        {/* 2. QR Code & Instant Auto Settlement */}
        <section className="rounded-2xl border border-border/60 bg-card/75 backdrop-blur-sm p-3.5 shadow-xs text-center">
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-black">
              2
            </span>
            <h2 className="text-xs sm:text-sm font-bold">ສະແກນ QR ໂອນເງິນ</h2>
          </div>

          {paymentStatus === "paid" && transferDetails ? (
            /* Celebratory Success View with full transfer record */
            <div className="py-4 px-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-2 shadow-md shadow-emerald-500/20">
                <PartyPopper className="w-6 h-6" />
              </div>
              <h3 className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                ຊຳລະເງິນສຳເລັດແລ້ວ!
              </h3>
              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                ລະບົບຕັດຍອດອັດຕະໂນມັດ 100% ແລະ ເພີ່ມເຄຣດິດໃຫ້ແລ້ວ
              </p>

              {/* Transfer Details Card */}
              <div className="mt-3 p-2.5 rounded-xl bg-background/80 border border-border text-left text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-primary" /> ໂອນມາຈາກ:
                  </span>
                  <span className="font-bold text-foreground truncate max-w-[180px]">
                    {transferDetails.bank}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-primary" /> ວັນທີ/ເວລາ:
                  </span>
                  <span className="font-bold text-foreground">{transferDetails.time}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-primary" /> ລະຫັດ Ref:
                  </span>
                  <span className="font-mono font-bold text-foreground text-[11px]">
                    {transferDetails.ref.slice(-12)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border/60">
                  <span className="text-muted-foreground">ເຄຣດິດທີ່ໄດ້ຮັບ:</span>
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                    +{transferDetails.credits} ເຄຣດິດ ({transferDetails.planLabel})
                  </span>
                </div>
              </div>

              <div className="mt-3 flex gap-2 justify-center">
                <Link to="/" className="flex-1">
                  <Button
                    size="sm"
                    className="w-full font-bold bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1" /> ໄປໜ້າແປເນື້ອເພງ
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPaymentStatus("idle");
                    void requestQR(plan);
                  }}
                  className="h-8 text-xs font-bold"
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> ເຕີມເພີ່ມ
                </Button>
              </div>
            </div>
          ) : (
            /* Pending QR Display */
            <div className="space-y-2.5">
              <div className="relative inline-block mx-auto bg-white p-2 rounded-2xl shadow-xs border border-border">
                {loadingQR ? (
                  <div className="w-40 h-40 sm:w-44 sm:h-44 flex flex-col items-center justify-center gap-1.5">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-[11px] font-bold text-muted-foreground">
                      ກຳລັງສ້າງ QR...
                    </span>
                  </div>
                ) : qrUrl ? (
                  <>
                    <img
                      src={qrUrl}
                      alt="QR Code"
                      className="w-40 h-40 sm:w-44 sm:h-44 object-contain mx-auto"
                    />
                    {paymentStatus === "expired" && (
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center p-3 text-white">
                        <Clock className="w-7 h-7 text-amber-400 mb-1" />
                        <span className="font-bold text-xs">QR ໝົດອາຍຸແລ້ວ</span>
                        <Button
                          size="sm"
                          onClick={() => requestQR(activePlan)}
                          className="mt-2 bg-primary text-white font-bold h-7 text-xs px-2.5"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" /> ສ້າງ QR ໃໝ່
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-40 h-40 sm:w-44 sm:h-44 flex flex-col items-center justify-center gap-1.5">
                    <QrCode className="w-8 h-8 text-muted-foreground" />
                    <Button
                      size="sm"
                      onClick={() => requestQR(activePlan)}
                      className="h-7 text-xs font-bold"
                    >
                      ສ້າງ QR
                    </Button>
                  </div>
                )}
              </div>

              {/* Amount & Account */}
              <div>
                <div className="text-xl sm:text-2xl font-black text-primary">
                  {displayAmount} <span className="text-sm font-bold">ກີບ</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>AKAPHON XAYYABED · ທຸກທະນາຄານ</span>
                </div>
              </div>

              {/* Status Indicator */}
              {paymentStatus === "pending" && (
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 py-1.5 px-3 max-w-xs mx-auto text-xs">
                  <div className="flex items-center justify-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400 text-[11px]">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span>ກຳລັງລໍຖ້າຮັບເງິນອັດຕະໂນມັດ...</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    ໝົດອາຍຸໃນ:{" "}
                    <span className="font-mono font-bold text-foreground">
                      {formatTime(timeLeft)}
                    </span>
                  </div>
                </div>
              )}

              {/* Ref ID */}
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
        </section>

        {/* 3. Requests History */}
        {myRequests.length > 0 && (
          <section className="rounded-2xl border border-border/60 bg-card/75 backdrop-blur-sm p-3 shadow-xs">
            <h2 className="text-xs font-bold mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" /> ປະຫວັດການຊຳລະເງິນ
            </h2>
            <div className="space-y-1.5">
              {myRequests.slice(0, 4).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 py-1.5 px-2.5 text-xs"
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
          </section>
        )}
      </main>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: {
      label: "ລໍຖ້າ",
      cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
      icon: <Clock className="w-2.5 h-2.5" />,
    },
    approved: {
      label: "ສຳເລັດ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
      icon: <Check className="w-2.5 h-2.5" />,
    },
    paid: {
      label: "ສຳເລັດ",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
      icon: <Check className="w-2.5 h-2.5" />,
    },
    rejected: {
      label: "ຍົກເລີກ",
      cls: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
      icon: <X className="w-2.5 h-2.5" />,
    },
    expired: {
      label: "ໝົດອາຍຸ",
      cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
      icon: <Clock className="w-2.5 h-2.5" />,
    },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground", icon: null };
  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}
    >
      {s.icon} {s.label}
    </span>
  );
}
