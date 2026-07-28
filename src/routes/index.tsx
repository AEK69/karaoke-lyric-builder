import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Copy,
  Crown,
  LogOut,
  Sparkles,
  Zap,
  Loader2,
  Check,
  Gift,
  Shield,
  Hourglass,
  PlusCircle,
  Code2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { translate, setCommunityWords, extractKnownWords, type Direction } from "@/lib/translator";
import { canonicalOrigin } from "@/lib/canonical-domain";
import { SuggestWordDialog } from "@/components/SuggestWordDialog";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import type { Session } from "@supabase/supabase-js";

const FREE_DAILY_LIMIT = 15;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lao Karaoke — ແປລາວ ↔ Karaoke" },
      { name: "description", content: "ເຄື່ອງມືແປພາສາລາວເປັນ Karaoke ໃຊ້ງານຟຣີ 15 ຄັ້ງ/ວັນ" },
    ],
  }),
  component: Index,
});

interface Profile {
  is_premium: boolean;
  premium_until: string | null;
  full_name: string | null;
  avatar_url: string | null;
  extra_credits: number;
}

function Index() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [used, setUsed] = useState(0);
  const [direction, setDirection] = useState<Direction>("lao-to-karaoke");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [apiQuota, setApiQuota] = useState<{ limit: number; remaining: number } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Approved community words extend the built-in dictionary.
  useEffect(() => {
    supabase
      .from("word_suggestions")
      .select("lao_word, karaoke_word")
      .eq("status", "approved")
      .limit(5000)
      .then(({ data }) => {
        if (data)
          setCommunityWords(data.map((r) => ({ lao: r.lao_word, karaoke: r.karaoke_word })));
      });
  }, []);

  // Remaining quota of the free public API (per caller, per day).
  useEffect(() => {
    fetch("/api/public/stats?days=1&limit=1")
      .then((r) => r.json())
      .then((d) => {
        if (d?.quota)
          setApiQuota({ limit: Number(d.quota.limit), remaining: Number(d.quota.remaining) });
      })
      .catch(() => undefined);
  }, []);

  const refresh = async () => {
    if (!session) return;
    const { data: p } = await supabase
      .from("profiles")
      .select("is_premium, premium_until, full_name, avatar_url, extra_credits")
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
    const { data: r } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!r);
  };

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setUsed(0);
      setIsAdmin(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const isPremium = useMemo(() => {
    if (!profile?.is_premium) return false;
    if (!profile.premium_until) return true;
    return new Date(profile.premium_until) > new Date();
  }, [profile]);

  const remaining = isPremium ? Infinity : Math.max(0, FREE_DAILY_LIMIT - used);
  const credits = profile?.extra_credits ?? 0;

  async function handleLogin() {
    setSigningIn(true);
    // Go straight to Supabase's GoTrue authorize endpoint. The Lovable OAuth
    // helper routes through /~oauth/initiate which only works on Lovable's
    // servers, so it breaks on localhost and Firebase. Google must be enabled
    // as a provider in the Supabase project for this to work.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: canonicalOrigin(),
      prompt: "select_account",
    });
    window.location.assign(`${supabaseUrl}/auth/v1/authorize?${params}`);
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

  async function doTranslate() {
    const text = input.trim();
    if (!text) {
      setOutput("");
      return;
    }
    if (!session) {
      toast.error("ກະລຸນາ Login ກ່ອນໃຊ້ງານ");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("try_consume_translation", {
        p_limit: FREE_DAILY_LIMIT,
      });
      if (error) throw error;
      const res = data as {
        allowed: boolean;
        is_premium: boolean;
        used: number;
        remaining: number;
        credits: number;
      };
      if (!res.allowed) {
        navigate({ to: "/payment" });
        toast.error(`ໃຊ້ຄົບໂຄຕ້າແລ້ວ — ສະໝັກ Premium ຫຼື ໃຊ້ໂຄດເຕີມ`);
        setBusy(false);
        return;
      }
      setUsed(res.used);
      if (profile) setProfile({ ...profile, extra_credits: res.credits });
      const translated = translate(text, direction);
      setOutput(translated);
      // Popular-word stats power the public /api/public/stats endpoint.
      const words = extractKnownWords(text, direction);
      if (words.length)
        void supabase.rpc("record_word_usage", { p_words: words, p_direction: direction });
    } catch (e) {
      toast.error("ເກີດຂໍ້ຜິດພາດ", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast.success("ສຳເນົາແລ້ວ");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Toaster richColors position="top-center" />
      <header className="sticky top-0 z-30 px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 bg-background/75 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/favicon1.ico"
              alt="Lao Karaoke"
              className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl shadow-glow object-cover shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-extrabold tracking-tight truncate">
                Lao Karaoke
              </h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                ແປລາວ ↔ Karaoke
              </p>
            </div>
          </div>
          {session && (
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {isAdmin && (
                <Link
                  to="/admin"
                  title="Admin"
                  className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-foreground text-background text-[11px] sm:text-xs font-bold shadow-soft hover:opacity-90 whitespace-nowrap"
                >
                  <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="sm:hidden">ແອັດມິນ</span>
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              )}
              <NotificationBell userId={session.user.id} />
              {isPremium ? (
                <span
                  title="Premium"
                  className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-[11px] sm:text-xs font-bold shadow-soft whitespace-nowrap"
                >
                  <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="sm:hidden">ພຣີມຽມ</span>
                  <span className="hidden sm:inline">PREMIUM</span>
                </span>
              ) : (
                <button
                  onClick={() => navigate({ to: "/payment" })}
                  title="Upgrade Premium"
                  className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-[11px] sm:text-xs font-bold shadow-soft hover:scale-105 transition whitespace-nowrap"
                >
                  <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="sm:hidden">ສະໝັກ</span>
                  <span className="hidden sm:inline">Upgrade</span>
                </button>
              )}
              <Link
                to="/redeem"
                className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-accent/15 text-accent text-[11px] sm:text-xs font-bold hover:bg-accent/25 transition whitespace-nowrap"
                title="ໃຊ້ໂຄດເຕີມ"
              >
                <Gift className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" /> ໂຄດ
              </Link>
              {(() => {
                const meta = session.user.user_metadata ?? {};
                const avatarUrl = profile?.avatar_url ?? meta.avatar_url ?? meta.picture;
                const name =
                  profile?.full_name ?? meta.full_name ?? meta.name ?? session.user.email;
                return avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={name ?? ""}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full ring-2 ring-primary/30 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary shrink-0">
                    {(name ?? "?")[0].toUpperCase()}
                  </div>
                );
              })()}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                title="Logout"
                className="h-8 w-8 sm:h-9 sm:w-9 shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:pb-10">
        <div className="max-w-4xl mx-auto">
          {!session ? (
            <LoginCard onGoogleLogin={handleLogin} loading={signingIn} />
          ) : (
            <>
              {/* Usage card — reads like a mobile app status tile */}
              <div className="glass rounded-3xl border border-white/40 shadow-soft p-4 mb-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Zap className="w-4 h-4 text-primary shrink-0" />
                      {isPremium ? (
                        <span className="text-gradient font-extrabold truncate">
                          ໃຊ້ງານບໍ່ຈຳກັດ
                        </span>
                      ) : (
                        <span className="truncate">
                          ເຫຼືອ <span className="font-extrabold text-primary">{remaining}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            / {FREE_DAILY_LIMIT} ຄັ້ງມື້ນີ້
                          </span>
                        </span>
                      )}
                    </div>
                    {!isPremium && (
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-button transition-all"
                          style={{ width: `${Math.min(100, (used / FREE_DAILY_LIMIT) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isPremium && profile?.premium_until && (
                      <PremiumCountdown until={profile.premium_until} />
                    )}
                    {credits > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-bold">
                        +{credits} ເຄຣດິດ
                      </span>
                    )}
                    {apiQuota && (
                      <span
                        title="ໂຄຕ້າ API ສາທາລະນະຕໍ່ມື້"
                        className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-bold"
                      >
                        API {apiQuota.remaining}/{apiQuota.limit}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="glass rounded-3xl shadow-soft border border-white/40 p-4 sm:p-6">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-4 text-sm font-bold">
                  <button
                    onClick={() => setDirection("lao-to-karaoke")}
                    className={`h-11 rounded-2xl transition ${direction === "lao-to-karaoke" ? "bg-gradient-button text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground active:scale-95"}`}
                  >
                    ລາວ
                  </button>
                  <button
                    onClick={swap}
                    className="w-11 h-11 rounded-2xl bg-primary/10 active:scale-90 flex items-center justify-center transition"
                    title="ສະຫຼັບ"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-primary" />
                  </button>
                  <button
                    onClick={() => setDirection("karaoke-to-lao")}
                    className={`h-11 rounded-2xl transition ${direction === "karaoke-to-lao" ? "bg-gradient-button text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground active:scale-95"}`}
                  >
                    Karaoke
                  </button>
                </div>

                <div className="flex items-center justify-between mb-1 ml-1">
                  <label className="block text-xs font-bold text-muted-foreground">
                    {direction === "lao-to-karaoke" ? "ພາສາລາວ" : "Karaoke"}
                  </label>
                  {input && (
                    <button
                      onClick={() => {
                        setInput("");
                        setOutput("");
                      }}
                      className="text-xs font-semibold text-muted-foreground active:opacity-60"
                    >
                      ລ້າງ
                    </button>
                  )}
                </div>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doTranslate();
                  }}
                  placeholder={
                    direction === "lao-to-karaoke"
                      ? "ພິມຂໍ້ຄວາມພາສາລາວທີ່ນີ້..."
                      : "Type karaoke text here..."
                  }
                  rows={4}
                  className="w-full rounded-2xl bg-white/70 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none p-4 text-base resize-none transition"
                />

                {/* Desktop translate button — on mobile the sticky bottom bar owns this action */}
                <div className="hidden sm:flex justify-center my-3">
                  <Button
                    onClick={doTranslate}
                    disabled={busy || !input.trim()}
                    className="bg-gradient-button text-primary-foreground hover:opacity-90 shadow-glow font-bold px-8 rounded-full transition"
                    size="lg"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    ແປພາສາ
                  </Button>
                </div>

                <div className="flex items-center justify-between mb-1 mt-3 sm:mt-0 ml-1">
                  <label className="text-xs font-bold text-muted-foreground">
                    {direction === "lao-to-karaoke" ? "ຜົນ Karaoke" : "ຜົນພາສາລາວ"}
                  </label>
                  {output && (
                    <button
                      onClick={copyOutput}
                      className="text-xs font-semibold text-primary flex items-center gap-1 active:opacity-60"
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

              {/* Secondary actions — chips on desktop, bottom bar handles mobile */}
              <div className="hidden sm:flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setShowSuggest(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> ເພີ່ມຄຳສັບ
                </button>
                <Link
                  to="/api-docs"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-xs font-bold hover:bg-muted/70 transition"
                >
                  <Code2 className="w-3.5 h-3.5" /> API
                </Link>
              </div>

              <p className="text-center text-xs text-muted-foreground mt-6">© 2026 Lao Karaoke</p>
            </>
          )}
        </div>
      </main>

      {/* Mobile app-style action bar */}
      {session && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background/85 backdrop-blur-xl border-t border-border/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSuggest(true)}
              className="w-12 h-12 shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center active:scale-90 transition"
              title="ເພີ່ມຄຳສັບ"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <Button
              onClick={doTranslate}
              disabled={busy || !input.trim()}
              className="flex-1 h-12 rounded-2xl bg-gradient-button text-primary-foreground font-extrabold text-base shadow-glow active:scale-[0.98] transition"
            >
              {busy ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Sparkles className="w-5 h-5 mr-2" />
              )}
              ແປພາສາ
            </Button>
            <Link
              to="/api-docs"
              className="w-12 h-12 shrink-0 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center active:scale-90 transition"
              title="API"
            >
              <Code2 className="w-5 h-5" />
            </Link>
          </div>
        </div>
      )}

      <SuggestWordDialog open={showSuggest} onClose={() => setShowSuggest(false)} />
    </div>
  );
}

function formatCountdown(iso: string, nowMs: number): string {
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return "ໝົດອາຍຸ";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d}ມື້ ${pad(h)}:${pad(m)}:${pad(s)}`;
}

// The premium countdown belongs to the signed-in user only — driven by their
// own profile.premium_until, not anyone else's.
function PremiumCountdown({ until }: { until: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-premium/10 text-premium font-mono text-xs font-bold"
      title="Premium ເຫຼືອ"
    >
      <Hourglass className="w-3 h-3" /> {formatCountdown(until, nowMs)}
    </span>
  );
}

function LoginCard({ onGoogleLogin, loading }: { onGoogleLogin: () => void; loading: boolean }) {
  const GoogleIcon = () => (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );

  return (
    <div className="max-w-md mx-auto mt-10 sm:mt-16 glass rounded-3xl shadow-soft border border-white/50 p-8">
      <div className="text-center mb-6">
        <img
          src="/favicon1.ico"
          alt="Lao Karaoke"
          className="w-20 h-20 mx-auto rounded-3xl shadow-glow object-cover mb-4"
        />
        <h2 className="text-2xl font-extrabold">ຍິນດີຕ້ອນຮັບ</h2>
        <p className="text-sm text-muted-foreground mt-1">ຟຣີ {FREE_DAILY_LIMIT} ຄັ້ງ/ວັນ</p>
      </div>

      <p className="text-center text-sm text-muted-foreground mb-6">
        ເຂົ້າສູ່ລະບົບດ້ວຍ Google ເພື່ອເລີ່ມໃຊ້ງານ
      </p>

      {/* Google login (เหลือทางเดียว — กันสร้างบัญชีมั่วเพื่อใช้โควต้าฟรีซ้ำ) */}
      <Button
        onClick={onGoogleLogin}
        disabled={loading}
        size="lg"
        variant="outline"
        className="w-full bg-white text-foreground hover:bg-white/90 border border-border shadow-soft font-bold"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <GoogleIcon />}
        ເຂົ້າດ້ວຍ Google
      </Button>
    </div>
  );
}
