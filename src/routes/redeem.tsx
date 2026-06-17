import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Gift, Loader2, Check, X, Clock, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalOrigin } from "@/lib/canonical-domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import type { Session } from "@supabase/supabase-js";

export const Route = createFileRoute("/redeem")({
  head: () => ({ meta: [{ title: "ໃຊ້ໂຄດເຕີມ — Lao Karaoke" }] }),
  component: RedeemPage,
});

type Result = { ok: true; credits: number; premium_days: number } | { ok: false; error: string };

function RedeemPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  function handleLogin() {
    // Same direct GoTrue authorize flow as the home page, but return the user
    // straight back to /redeem so they can use their code without bouncing home.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: `${canonicalOrigin()}/redeem`,
      prompt: "select_account",
    });
    window.location.assign(`${supabaseUrl}/auth/v1/authorize?${params}`);
  }

  async function redeem() {
    if (!code.trim()) return;
    if (!session) { setResult({ ok: false, error: "not_authenticated" }); return; }
    setBusy(true); setResult(null);
    try {
      const { data, error } = await supabase.rpc("redeem_topup_code", { p_code: code.trim() });
      if (error) { setResult({ ok: false, error: error.message }); return; }
      const r = data as { ok: boolean; error?: string; credits?: number; premium_days?: number };
      if (r.ok) setResult({ ok: true, credits: r.credits ?? 0, premium_days: r.premium_days ?? 0 });
      else setResult({ ok: false, error: r.error ?? "unknown" });
    } catch (e) {
      // Never leave the button silently stuck — surface whatever went wrong.
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const errorMsg = (e: string) =>
    e === "invalid_code" ? "ໂຄດບໍ່ຖືກຕ້ອງ — ກວດອີກຄັ້ງ"
    : e === "already_used" || e === "already_redeemed" ? "ທ່ານໃຊ້ໂຄດນີ້ໄປແລ້ວ"
    : e === "used_up" ? "ໂຄດນີ້ມີຄົນໃຊ້ຄົບຈຳນວນແລ້ວ"
    : e === "expired" ? "ໂຄດໝົດອາຍຸແລ້ວ"
    : e === "not_authenticated" ? "ກະລຸນາເຂົ້າສູ່ລະບົບກ່ອນໃຊ້ໂຄດ"
    : `ຜິດພາດ: ${e}`;

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70"><ArrowLeft className="w-4 h-4" /> ກັບ</Link>
          <h1 className="text-xl font-extrabold flex items-center gap-2"><Gift className="w-5 h-5 text-accent" /> ໃຊ້ໂຄດເຕີມ</h1>
          <div className="w-16" />
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 sm:px-6 pb-12">
        {!checking && !session ? (
          <div className="glass rounded-3xl shadow-soft border border-white/40 p-6 text-center">
            <LogIn className="w-10 h-10 mx-auto text-primary mb-3" />
            <p className="font-bold mb-1">ຕ້ອງເຂົ້າສູ່ລະບົບກ່ອນ</p>
            <p className="text-sm text-muted-foreground mb-4">ເຂົ້າສູ່ລະບົບດ້ວຍ Google ເພື່ອໃຊ້ໂຄດເຕີມ</p>
            <Button onClick={handleLogin} size="lg" className="bg-gradient-button text-primary-foreground font-bold">
              <LogIn className="w-4 h-4 mr-2" /> ເຂົ້າສູ່ລະບົບດ້ວຍ Google
            </Button>
          </div>
        ) : (
        <div className="glass rounded-3xl shadow-soft border border-white/40 p-6">
          <p className="text-sm text-muted-foreground mb-4 text-center">ປ້ອນໂຄດ 12 ຕົວທີ່ໄດ້ຮັບຈາກແອັດມິນ</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXXXXXXXX"
            className="text-center font-mono text-xl tracking-widest h-14"
            maxLength={12}
          />
          <Button onClick={redeem} disabled={busy || !code.trim()} size="lg" className="w-full mt-3 bg-gradient-button text-primary-foreground font-bold">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />} ໃຊ້ໂຄດ
          </Button>

          {result && result.ok && (
            <div className="mt-4 rounded-2xl bg-success/10 border-2 border-success/30 p-4 text-center">
              <Check className="w-10 h-10 mx-auto text-success mb-2" />
              <div className="font-extrabold text-lg">ສຳເລັດ!</div>
              {result.credits > 0 && <div className="text-sm">+{result.credits} ເຄຣດິດ</div>}
              {result.premium_days > 0 && <div className="text-sm">+{result.premium_days} ມື້ Premium</div>}
              <Link to="/"><Button variant="outline" className="mt-3">ກັບໄປແປຕໍ່</Button></Link>
            </div>
          )}
          {result && !result.ok && (
            <div className="mt-4 rounded-2xl bg-destructive/10 border-2 border-destructive/30 p-4 text-center">
              {result.error === "expired" ? <Clock className="w-10 h-10 mx-auto text-destructive mb-2" /> : <X className="w-10 h-10 mx-auto text-destructive mb-2" />}
              <div className="font-bold">{errorMsg(result.error)}</div>
            </div>
          )}
        </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          ຍັງບໍ່ມີໂຄດ? <Link to="/" className="text-primary font-bold hover:underline">ສະໝັກ Premium / ຊື້ເຄຣດິດ</Link>
        </div>
      </main>
    </div>
  );
}
