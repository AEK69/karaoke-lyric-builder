import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Copy, Crown, LogOut, Sparkles, Zap, Loader2, Check, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { translate, type Direction } from "@/lib/translator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Session } from "@supabase/supabase-js";

const FREE_DAILY_LIMIT = 10;
const WHATSAPP = "2029988148";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lao Karaoke — ແປລາວ ↔ Karaoke" },
      { name: "description", content: "ເຄື່ອງມືແປພາສາລາວເປັນ Karaoke ແລະ ກັບຄືນ ໃຊ້ງານຟຣີ" },
      { property: "og:title", content: "Lao Karaoke — ແປລາວ ↔ Karaoke" },
      { property: "og:description", content: "ເຄື່ອງມືແປພາສາລາວເປັນ Karaoke ແລະ ກັບຄືນ" },
    ],
  }),
  component: Index,
});

interface Profile {
  is_premium: boolean;
  premium_until: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [used, setUsed] = useState(0);
  const [direction, setDirection] = useState<Direction>("lao-to-karaoke");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load profile + usage
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setUsed(0);
      return;
    }
    (async () => {
      const { data: p } = await supabase
        .from("profiles")
        .select("is_premium, premium_until, full_name, avatar_url")
        .eq("id", session.user.id)
        .maybeSingle();
      setProfile(p as Profile | null);
      const today = new Date().toISOString().slice(0, 10);
      const { data: u } = await supabase
        .from("daily_usage")
        .select("count")
        .eq("user_id", session.user.id)
        .eq("used_date", today)
        .maybeSingle();
      setUsed((u as { count: number } | null)?.count ?? 0);
    })();
  }, [session]);

  const isPremium = useMemo(() => {
    if (!profile?.is_premium) return false;
    if (!profile.premium_until) return true;
    return new Date(profile.premium_until) > new Date();
  }, [profile]);

  const remaining = isPremium ? Infinity : Math.max(0, FREE_DAILY_LIMIT - used);

  async function handleLogin() {
    setSigningIn(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("ເຂົ້າສູ່ລະບົບລົ້ມເຫຼວ", { description: String(result.error.message ?? result.error) });
      setSigningIn(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setOutput("");
    setInput("");
  }

  function swap() {
    setDirection((d) => (d === "lao-to-karaoke" ? "karaoke-to-lao" : "lao-to-karaoke"));
    setInput(output);
    setOutput("");
  }

  async function doTranslate(text: string) {
    if (!text.trim()) {
      setOutput("");
      return;
    }
    if (!session) {
      toast.error("ກະລຸນາ Login ກ່ອນໃຊ້ງານ");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("try_consume_translation", { p_limit: FREE_DAILY_LIMIT });
      if (error) throw error;
      const res = data as { allowed: boolean; is_premium: boolean; used: number; remaining: number };
      if (!res.allowed) {
        setShowPremium(true);
        toast.error(`ໃຊ້ຄົບໂຄຕ້າ ${FREE_DAILY_LIMIT} ຄັ້ງ/ວັນແລ້ວ — ສະໝັກ Premium`);
        setBusy(false);
        return;
      }
      setUsed(res.used);
      setOutput(translate(text, direction));
    } catch (e) {
      toast.error("ເກີດຂໍ້ຜິດພາດ", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  // Live debounced translate (after login)
  function onChangeInput(v: string) {
    setInput(v);
    if (!session) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doTranslate(v), 450);
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast.success("ສຳເນົາແລ້ວ");
    setTimeout(() => setCopied(false), 1500);
  }

  function openWhatsApp() {
    const msg = encodeURIComponent(
      `👑 ຂໍ Upgrade Premium Lao Karaoke\n\nUser: ${profile?.full_name ?? session?.user.email ?? ""}\nEmail: ${session?.user.email ?? ""}\n`
    );
    window.open(`https://wa.me/${WHATSAPP}?text=${msg}`, "_blank");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="px-4 sm:px-6 pt-6 pb-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-hero shadow-glow flex items-center justify-center text-white text-xl font-black">
              ລ
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">Lao Karaoke</h1>
              <p className="text-xs text-muted-foreground">ແປລາວ ↔ Karaoke</p>
            </div>
          </div>

          {session ? (
            <div className="flex items-center gap-2">
              {isPremium ? (
                <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-xs font-bold shadow-soft">
                  <Crown className="w-3.5 h-3.5" /> PREMIUM
                </span>
              ) : (
                <button
                  onClick={() => setShowPremium(true)}
                  className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-xs font-bold shadow-soft hover:scale-105 transition"
                >
                  <Crown className="w-3.5 h-3.5" /> Upgrade
                </button>
              )}
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full ring-2 ring-primary/30" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">
                  {(profile?.full_name ?? session.user.email ?? "?")[0].toUpperCase()}
                </div>
              )}
              <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 sm:px-6 pb-10">
        <div className="max-w-4xl mx-auto">
          {!session ? (
            <LoginCard onLogin={handleLogin} loading={signingIn} />
          ) : (
            <>
              {/* Quota bar */}
              <div className="mb-4 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="font-medium">
                    {isPremium ? (
                      <span className="text-gradient font-bold">ໃຊ້ງານບໍ່ຈຳກັດ</span>
                    ) : (
                      <>
                        ເຫຼືອ <span className="font-bold text-primary">{remaining}</span> / {FREE_DAILY_LIMIT} ຄັ້ງມື້ນີ້
                      </>
                    )}
                  </span>
                </div>
                {!isPremium && (
                  <button
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() => setShowPremium(true)}
                  >
                    ສະໝັກ Premium →
                  </button>
                )}
              </div>

              {/* Translator card */}
              <div className="glass rounded-3xl shadow-soft border border-white/40 p-4 sm:p-6">
                {/* Direction selector */}
                <div className="flex items-center justify-center gap-2 mb-4 text-sm font-bold">
                  <button
                    onClick={() => setDirection("lao-to-karaoke")}
                    className={`px-4 py-2 rounded-full transition ${
                      direction === "lao-to-karaoke"
                        ? "bg-gradient-button text-primary-foreground shadow-glow"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    ລາວ
                  </button>
                  <button
                    onClick={swap}
                    className="w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition"
                    title="ສະຫຼັບ"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-primary" />
                  </button>
                  <button
                    onClick={() => setDirection("karaoke-to-lao")}
                    className={`px-4 py-2 rounded-full transition ${
                      direction === "karaoke-to-lao"
                        ? "bg-gradient-button text-primary-foreground shadow-glow"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    Karaoke
                  </button>
                </div>

                {/* Input */}
                <label className="block text-xs font-bold text-muted-foreground mb-1 ml-1">
                  {direction === "lao-to-karaoke" ? "ພາສາລາວ" : "Karaoke"}
                </label>
                <textarea
                  value={input}
                  onChange={(e) => onChangeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doTranslate(input);
                  }}
                  placeholder={
                    direction === "lao-to-karaoke"
                      ? "ພິມຂໍ້ຄວາມພາສາລາວທີ່ນີ້... (Ctrl+Enter ເພື່ອແປ)"
                      : "Type karaoke text here... (sabaidee, khob jai, ...)"
                  }
                  rows={4}
                  className="w-full rounded-2xl bg-white/70 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none p-4 text-base resize-none transition"
                />

                <div className="flex justify-center my-3">
                  <Button
                    onClick={() => doTranslate(input)}
                    disabled={busy || !input.trim()}
                    className="bg-gradient-button text-primary-foreground hover:opacity-90 hover:scale-[1.02] shadow-glow font-bold px-8 rounded-full transition"
                    size="lg"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    ແປພາສາ
                  </Button>
                </div>

                {/* Output */}
                <div className="flex items-center justify-between mb-1 ml-1">
                  <label className="text-xs font-bold text-muted-foreground">
                    {direction === "lao-to-karaoke" ? "ຜົນ Karaoke" : "ຜົນພາສາລາວ"}
                  </label>
                  {output && (
                    <button
                      onClick={copyOutput}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "ສຳເນົາແລ້ວ" : "ສຳເນົາ"}
                    </button>
                  )}
                </div>
                <div className="min-h-[120px] rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/15 p-4 text-base whitespace-pre-wrap break-words">
                  {output || <span className="text-muted-foreground">…</span>}
                </div>
              </div>

              {/* Footer info */}
              <p className="text-center text-xs text-muted-foreground mt-6">
                © 2026 Lao Karaoke · ດຶງຂໍ້ມູນແປຈາກເວັບຕົ້ນສະບັບ
              </p>
            </>
          )}
        </div>
      </main>

      <PremiumDialog open={showPremium} onClose={() => setShowPremium(false)} onWhatsApp={openWhatsApp} />
    </div>
  );
}

function LoginCard({ onLogin, loading }: { onLogin: () => void; loading: boolean }) {
  return (
    <div className="max-w-md mx-auto mt-10 sm:mt-16 glass rounded-3xl shadow-soft border border-white/50 p-8 text-center">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-hero shadow-glow flex items-center justify-center text-white text-4xl font-black mb-5">
        ລ
      </div>
      <h2 className="text-2xl font-extrabold mb-2">ຍິນດີຕ້ອນຮັບ</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Login ດ້ວຍ Google ເພື່ອເລີ່ມໃຊ້ງານ
        <br />
        ຟຣີ {FREE_DAILY_LIMIT} ຄັ້ງ/ວັນ · ບັນທຶກປະຫວັດ · ສະໝັກ Premium ໄດ້
      </p>
      <Button
        onClick={onLogin}
        disabled={loading}
        size="lg"
        className="w-full bg-white text-foreground hover:bg-white/90 border border-border shadow-soft font-bold"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        )}
        ເຂົ້າດ້ວຍ Google
      </Button>
      <div className="grid grid-cols-3 gap-2 mt-6 text-xs">
        <div className="p-3 rounded-xl bg-success/10 text-success font-semibold">ຟຣີ 10/ວັນ</div>
        <div className="p-3 rounded-xl bg-accent/10 text-accent font-semibold">ບັນທຶກປະຫວັດ</div>
        <div className="p-3 rounded-xl bg-premium/20 text-foreground font-semibold">Premium</div>
      </div>
    </div>
  );
}

function PremiumDialog({
  open,
  onClose,
  onWhatsApp,
}: {
  open: boolean;
  onClose: () => void;
  onWhatsApp: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Crown className="w-6 h-6 text-premium" /> Upgrade Premium
          </DialogTitle>
          <DialogDescription>ໃຊ້ງານບໍ່ຈຳກັດ — ບໍ່ມີໂຄຕ້າ</DialogDescription>
        </DialogHeader>

        <div className="bg-gradient-premium rounded-2xl p-5 text-premium-foreground my-2">
          <div className="text-3xl font-black">5,000 ກີບ</div>
          <div className="text-sm font-semibold opacity-80">/ ເດືອນ · ຫຼື 60,000 ກີບ / ປີ</div>
        </div>

        <ul className="space-y-2 text-sm">
          {[
            "ແປພາສາບໍ່ຈຳກັດ — ບໍ່ມີໂຄຕ້າ 10 ຄັ້ງ/ວັນ",
            "ບໍ່ມີໂຄສະນາ — ໃຊ້ງານສະອາດ",
            "ຊ່ວຍເຫຼືອດ່ວນພາຍໃນ 24 ຊົ່ວໂມງ",
            "Premium Badge ໃນໂປຣໄຟລ໌",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div className="bg-muted rounded-xl p-3 text-xs text-muted-foreground mt-2">
          <div className="font-bold text-foreground mb-1">💳 ຂັ້ນຕອນຈ່າຍ P2P</div>
          1. ໂອນຜ່ານ BCEL One / LAPNet LAO QR — CHANTHAJONE PHIMMASONE MR
          <br />
          2. Screenshot ສະລິບ
          <br />
          3. ສົ່ງ Slip ຜ່ານ WhatsApp ດ້ານລຸ່ມ
        </div>

        <Button
          onClick={onWhatsApp}
          size="lg"
          className="w-full bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold mt-2"
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          ສົ່ງ Slip ຜ່ານ WhatsApp
        </Button>
      </DialogContent>
    </Dialog>
  );
}
