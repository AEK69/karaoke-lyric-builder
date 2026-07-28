import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { ArrowLeft, QrCode, MessageCircle, Upload, Loader2, Crown, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { generateOnePayDynamicQR } from "@/lib/onepay";

export const Route = createFileRoute("/payment")({
  head: () => ({ meta: [{ title: "ຊຳລະເງິນ — Lao Karaoke" }] }),
  component: PaymentPage,
});

const WHATSAPP = "85602058662540";

interface Plan {
  label: string;
  price: number;
  days?: number;
  credits?: number;
}
const PLANS: Plan[] = [
  { label: "20 ເຄຣດິດ", price: 5000, credits: 20 },
  { label: "60 ເຄຣດິດ", price: 10000, credits: 60 },
  { label: "Premium 1 ເດືອນ", price: 30000, days: 30 },
  { label: "Premium 1 ປີ", price: 300000, days: 365 },
];

function PaymentPage() {
  const [userEmail, setUserEmail] = useState<string>("");
  const [userName, setUserName] = useState<string>("");
  const [plan, setPlan] = useState<Plan>(PLANS[2]);
  const [slip, setSlip] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const qr = useMemo(() => generateOnePayDynamicQR(plan.price), [plan]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      setUserEmail(data.session.user.email ?? "");
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", data.session.user.id)
        .maybeSingle();
      setUserName((p as { full_name: string | null } | null)?.full_name ?? "");
    });
  }, []);

  function onPickSlip(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setSlip(f);
    if (slipPreview) URL.revokeObjectURL(slipPreview);
    setSlipPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        toast.error("ກະລຸນາ Login ກ່ອນ");
        return;
      }
      const { data, error } = await supabase
        .from("payment_requests")
        .insert({
          user_id: s.session.user.id,
          amount: plan.price,
          plan_label: plan.label,
          credits: plan.credits ?? 0,
          premium_days: plan.days ?? 0,
        })
        .select("id")
        .single();
      if (error) throw error;
      setRequestId((data as { id: string }).id);
      toast.success("ບັນທຶກຄຳຂໍແລ້ວ — ກະລຸນາສົ່ງສະລິບໃຫ້ແອັດມິນຜ່ານ WhatsApp");
      // Open WhatsApp with details
      const msg = encodeURIComponent(
        `👑 Lao Karaoke — ຊຳລະເງິນ\n\n` +
          `ແພັກເກດ: ${plan.label}\nລາຄາ: ${plan.price.toLocaleString()} ກີບ\n` +
          `User: ${userName || "(ບໍ່ມີຊື່)"}\nEmail: ${userEmail}\n` +
          `Ref: ${(data as { id: string }).id}\n\n` +
          `(ກະລຸນາແນບສະລິບການໂອນ)`,
      );
      window.open(`https://wa.me/${WHATSAPP}?text=${msg}`, "_blank");
    } catch (e) {
      toast.error("ຜິດພາດ", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70"
          >
            <ArrowLeft className="w-4 h-4" /> ກັບ
          </Link>
          <h1 className="text-xl font-extrabold flex items-center gap-2">
            <Crown className="w-5 h-5 text-premium" /> ຊຳລະເງິນ
          </h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pb-12 space-y-4">
        <div className="glass rounded-3xl p-5 border border-white/40 shadow-soft">
          <h2 className="font-extrabold mb-3">1. ເລືອກແພັກເກດ</h2>
          <div className="grid grid-cols-2 gap-2">
            {PLANS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPlan(p)}
                className={`text-left p-3 rounded-xl border-2 transition ${plan.label === p.label ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
              >
                <div className="text-xs font-bold">{p.label}</div>
                <div className="text-sm font-extrabold text-primary">
                  {p.price.toLocaleString()} ກີບ
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/40 shadow-soft text-center">
          <h2 className="font-extrabold mb-3 flex items-center justify-center gap-1">
            <QrCode className="w-4 h-4" /> 2. ສະແກນຈ່າຍ {plan.price.toLocaleString()} ກີບ
          </h2>
          <img
            src={qr.qrCodeUrl}
            alt="OnePay QR"
            className="mx-auto w-64 h-64 bg-white rounded-2xl p-2"
          />
          <div className="text-xs text-muted-foreground mt-2">AKAPHON XAYYABED · OnePay</div>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/40 shadow-soft">
          <h2 className="font-extrabold mb-3">3. ແນບສະລິບການໂອນ (ໃນເຄື່ອງ)</h2>
          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-2xl p-6 cursor-pointer hover:border-primary/50 transition">
            <input type="file" accept="image/*" onChange={onPickSlip} className="hidden" />
            <Upload className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm font-bold">{slip ? slip.name : "ກົດເພື່ອເລືອກຮູບສະລິບ"}</span>
          </label>
          {slipPreview && (
            <img src={slipPreview} alt="slip" className="mt-3 max-h-64 mx-auto rounded-xl border" />
          )}
          <p className="text-xs text-muted-foreground mt-2">
            ຫຼັງຈາກກົດ "ສົ່ງສະລິບ" ລະບົບຈະເປີດ WhatsApp ໃຫ້ສົ່ງຮູບສະລິບໄປຫາແອັດມິນອັດຕະໂນມັດ (020
            5866 2540)
          </p>
        </div>

        <Button
          onClick={submit}
          disabled={submitting}
          size="lg"
          className="w-full bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <MessageCircle className="w-4 h-4 mr-2" />
          )}
          ສົ່ງສະລິບໄປ WhatsApp
        </Button>

        {requestId && (
          <div className="rounded-2xl bg-success/10 border-2 border-success/30 p-4 text-center">
            <Check className="w-8 h-8 mx-auto text-success mb-1" />
            <div className="font-bold text-sm">
              ບັນທຶກຄຳຂໍແລ້ວ — Ref: <span className="font-mono">{requestId.slice(0, 8)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ແອັດມິນຈະອະນຸມັດ ແລະ ເຕີມເຄຣດິດ/Premium ໃຫ້ໃນ 24 ຊມ
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
