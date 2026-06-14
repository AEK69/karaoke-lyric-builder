import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Copy, Crown, LogOut, Sparkles, Zap, Loader2, Check, Gift, Shield, History, Mail, Lock, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { translate, type Direction } from "@/lib/translator";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
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
      .from("daily_usage").select("count")
      .eq("user_id", session.user.id).eq("used_date", today).maybeSingle();
    setUsed((u as { count: number } | null)?.count ?? 0);
    const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin").maybeSingle();
    setIsAdmin(!!r);
  };

  useEffect(() => {
    if (!session) { setProfile(null); setUsed(0); setIsAdmin(false); return; }
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
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
      extraParams: { prompt: "select_account" },
    });
    if (result.error) {
      toast.error("ເຂົ້າສູ່ລະບົບລົ້ມເຫຼວ", { description: result.error.message });
      setSigningIn(false);
    }
  }

  async function handleEmailLogin(email: string, password: string) {
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error("ເຂົ້າສູ່ລະບົບລົ້ມເຫຼວ", { description: error.message });
    }
    setSigningIn(false);
  }

  async function handleEmailSignup(email: string, password: string, fullName: string) {
    setSigningIn(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) {
      console.error("[signup error]", error);
      toast.error("ສະໝັກສະມາຊິກລົ້ມເຫຼວ", { description: `${error.message} (${error.status ?? error.name})` });
    } else if (data.session) {
      toast.success("ສ້າງບັນຊີສຳເລັດ! ຍິນດີຕ້ອນຮັບ 🎉");
    } else {
      toast.success("ສ້າງບັນຊີສຳເລັດ! ກວດເບິ່ງອີເມລເພື່ອຢືນຢັນ");
    }
    setSigningIn(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setOutput(""); setInput("");
  }

  function swap() {
    setDirection((d) => (d === "lao-to-karaoke" ? "karaoke-to-lao" : "lao-to-karaoke"));
    setInput(output); setOutput("");
  }

  async function doTranslate() {
    const text = input.trim();
    if (!text) { setOutput(""); return; }
    if (!session) { toast.error("ກະລຸນາ Login ກ່ອນໃຊ້ງານ"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("try_consume_translation", { p_limit: FREE_DAILY_LIMIT });
      if (error) throw error;
      const res = data as { allowed: boolean; is_premium: boolean; used: number; remaining: number; credits: number };
      if (!res.allowed) {
        navigate({ to: "/payment" });
        toast.error(`ໃຊ້ຄົບໂຄຕ້າແລ້ວ — ສະໝັກ Premium ຫຼື ໃຊ້ໂຄດເຕີມ`);
        setBusy(false); return;
      }
      setUsed(res.used);
      if (profile) setProfile({ ...profile, extra_credits: res.credits });
      const translated = translate(text, direction);
      setOutput(translated);
      // Log to history (best-effort, non-blocking)
      void supabase.rpc("log_translation", { p_direction: direction, p_input: text, p_output: translated });
    } catch (e) {
      toast.error("ເກີດຂໍ້ຜິດພາດ", { description: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true); toast.success("ສຳເນົາແລ້ວ");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-hero shadow-glow flex items-center justify-center text-white text-xl font-black">ລ</div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">Lao Karaoke</h1>
              <p className="text-xs text-muted-foreground">ແປລາວ ↔ Karaoke</p>
            </div>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Link to="/admin" className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-foreground text-background text-xs font-bold shadow-soft hover:opacity-90">
                  <Shield className="w-3.5 h-3.5" /> Admin
                </Link>
              )}
              {isPremium ? (
                <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-xs font-bold shadow-soft">
                  <Crown className="w-3.5 h-3.5" /> PREMIUM
                </span>
              ) : (
                <button onClick={() => navigate({ to: "/payment" })} className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-premium text-premium-foreground text-xs font-bold shadow-soft hover:scale-105 transition">
                  <Crown className="w-3.5 h-3.5" /> Upgrade
                </button>
              )}
              <Link to="/redeem" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 transition" title="ໃຊ້ໂຄດເຕີມ">
                <Gift className="w-3.5 h-3.5" /> ໂຄດ
              </Link>
              <Link to="/history" className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted text-xs font-bold hover:bg-muted/70 transition" title="ປະຫວັດ">
                <History className="w-3.5 h-3.5" /> ປະຫວັດ
              </Link>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full ring-2 ring-primary/30" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">
                  {(profile?.full_name ?? session.user.email ?? "?")[0].toUpperCase()}
                </div>
              )}
              <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout"><LogOut className="w-4 h-4" /></Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 pb-10">
        <div className="max-w-4xl mx-auto">
          {!session ? (
            <LoginCard
              onGoogleLogin={handleLogin}
              onEmailLogin={handleEmailLogin}
              onEmailSignup={handleEmailSignup}
              loading={signingIn}
            />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between text-sm flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-primary" />
                    {isPremium ? (
                      <span className="text-gradient font-bold">ໃຊ້ງານບໍ່ຈຳກັດ</span>
                    ) : (
                      <span>ເຫຼືອ <span className="font-bold text-primary">{remaining}</span> / {FREE_DAILY_LIMIT} ຄັ້ງ</span>
                    )}
                  </div>
                  {credits > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-bold">
                      +{credits} ເຄຣດິດ
                    </span>
                  )}
                </div>
                {!isPremium && (
                  <button className="text-xs font-semibold text-primary hover:underline" onClick={() => navigate({ to: "/payment" })}>
                    ສະໝັກ Premium →
                  </button>
                )}
              </div>

              <div className="glass rounded-3xl shadow-soft border border-white/40 p-4 sm:p-6">
                <div className="flex items-center justify-center gap-2 mb-4 text-sm font-bold">
                  <button onClick={() => setDirection("lao-to-karaoke")} className={`px-4 py-2 rounded-full transition ${direction === "lao-to-karaoke" ? "bg-gradient-button text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>ລາວ</button>
                  <button onClick={swap} className="w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition" title="ສະຫຼັບ"><ArrowLeftRight className="w-4 h-4 text-primary" /></button>
                  <button onClick={() => setDirection("karaoke-to-lao")} className={`px-4 py-2 rounded-full transition ${direction === "karaoke-to-lao" ? "bg-gradient-button text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>Karaoke</button>
                </div>

                <label className="block text-xs font-bold text-muted-foreground mb-1 ml-1">
                  {direction === "lao-to-karaoke" ? "ພາສາລາວ" : "Karaoke"}
                </label>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doTranslate(); }}
                  placeholder={direction === "lao-to-karaoke" ? "ພິມຂໍ້ຄວາມພາສາລາວທີ່ນີ້... (Ctrl+Enter ເພື່ອແປ)" : "Type karaoke text here..."}
                  rows={4}
                  className="w-full rounded-2xl bg-white/70 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none p-4 text-base resize-none transition"
                />

                <div className="flex justify-center my-3">
                  <Button onClick={doTranslate} disabled={busy || !input.trim()} className="bg-gradient-button text-primary-foreground hover:opacity-90 hover:scale-[1.02] shadow-glow font-bold px-8 rounded-full transition" size="lg">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    ແປພາສາ
                  </Button>
                </div>

                <div className="flex items-center justify-between mb-1 ml-1">
                  <label className="text-xs font-bold text-muted-foreground">{direction === "lao-to-karaoke" ? "ຜົນ Karaoke" : "ຜົນພາສາລາວ"}</label>
                  {output && (
                    <button onClick={copyOutput} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "ສຳເນົາແລ້ວ" : "ສຳເນົາ"}
                    </button>
                  )}
                </div>
                <div className="min-h-[120px] rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/15 p-4 text-base whitespace-pre-wrap break-words">
                  {output || <span className="text-muted-foreground">…</span>}
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground mt-6">© 2026 Lao Karaoke</p>
            </>
          )}
        </div>
      </main>

    </div>
  );
}

function LoginCard({
  onGoogleLogin,
  onEmailLogin,
  onEmailSignup,
  loading,
}: {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string, password: string) => void;
  onEmailSignup: (email: string, password: string, fullName: string) => void;
  loading: boolean;
}) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    if (tab === "login") {
      onEmailLogin(email, password);
    } else {
      if (!fullName.trim()) { toast.error("ກະລຸນາໃສ່ຊື່ຂອງທ່ານ"); return; }
      onEmailSignup(email, password, fullName.trim());
    }
  }

  const GoogleIcon = () => (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );

  return (
    <div className="max-w-md mx-auto mt-10 sm:mt-16 glass rounded-3xl shadow-soft border border-white/50 p-8">
      <div className="text-center mb-6">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-hero shadow-glow flex items-center justify-center text-white text-4xl font-black mb-4">ລ</div>
        <h2 className="text-2xl font-extrabold">ຍິນດີຕ້ອນຮັບ</h2>
        <p className="text-sm text-muted-foreground mt-1">ຟຣີ {FREE_DAILY_LIMIT} ຄັ້ງ/ວັນ</p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-2xl bg-muted p-1 mb-6">
        <button
          onClick={() => setTab("login")}
          className={`flex-1 py-2 text-sm font-bold rounded-xl transition ${tab === "login" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          ເຂົ້າສູ່ລະບົບ
        </button>
        <button
          onClick={() => setTab("signup")}
          className={`flex-1 py-2 text-sm font-bold rounded-xl transition ${tab === "signup" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          ສະໝັກສະມາຊິກ
        </button>
      </div>

      {/* Email/password form */}
      <form onSubmit={handleSubmit} className="space-y-3 mb-4">
        {tab === "signup" && (
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="ຊື່ຂອງທ່ານ"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/80 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm transition"
            />
          </div>
        )}
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="email"
            placeholder="ອີເມລ"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/80 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm transition"
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="password"
            placeholder="ລະຫັດຜ່ານ"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/80 border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm transition"
          />
        </div>
        <Button type="submit" disabled={loading} size="lg" className="w-full bg-gradient-button text-primary-foreground font-bold shadow-glow">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {tab === "login" ? "ເຂົ້າສູ່ລະບົບ" : "ສ້າງບັນຊີ"}
        </Button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground font-medium">ຫຼື</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Google login */}
      <Button onClick={onGoogleLogin} disabled={loading} size="lg" variant="outline" className="w-full bg-white text-foreground hover:bg-white/90 border border-border shadow-soft font-bold">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <GoogleIcon />}
        ເຂົ້າດ້ວຍ Google
      </Button>
    </div>
  );
}