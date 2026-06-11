import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Crown, Plus, Search, Loader2, Copy, Check, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Lao Karaoke" }] }),
  component: AdminPage,
});

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_premium: boolean;
  premium_until: string | null;
  extra_credits: number;
  created_at: string;
}

interface TopupCode {
  id: string;
  code: string;
  credits: number;
  premium_days: number;
  note: string | null;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

function AdminPage() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<TopupCode[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"users" | "codes">("users");

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { navigate({ to: "/" }); return; }
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", s.session.user.id).eq("role", "admin").maybeSingle();
      if (!r) { setAuthorized(false); return; }
      setAuthorized(true);
      void search("");
      void loadCodes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(q: string) {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_search_users", { p_query: q });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setUsers((data ?? []) as AdminUser[]);
  }

  async function loadCodes() {
    const { data, error } = await supabase.from("topup_codes").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) { toast.error(error.message); return; }
    setCodes((data ?? []) as TopupCode[]);
  }

  async function grantPremium(userId: string, days: number) {
    const { error } = await supabase.rpc("admin_grant_premium", { p_user: userId, p_days: days });
    if (error) return toast.error(error.message);
    toast.success(`+${days} ມື້ Premium`);
    void search(query);
  }

  async function revokePremium(userId: string) {
    const { error } = await supabase.rpc("admin_revoke_premium", { p_user: userId });
    if (error) return toast.error(error.message);
    toast.success("ຍົກເລີກ Premium");
    void search(query);
  }

  async function addCredits(userId: string, amount: number) {
    const { error } = await supabase.rpc("admin_add_credits", { p_user: userId, p_amount: amount });
    if (error) return toast.error(error.message);
    toast.success(`${amount >= 0 ? "+" : ""}${amount} ເຄຣດິດ`);
    void search(query);
  }

  if (authorized === null) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-3xl p-8 text-center max-w-sm">
          <h2 className="text-xl font-extrabold mb-2">ບໍ່ມີສິດເຂົ້າເຖິງ</h2>
          <p className="text-sm text-muted-foreground mb-4">ໜ້ານີ້ສຳລັບແອັດມິນເທົ່ານັ້ນ</p>
          <Link to="/"><Button>ກັບໜ້າຫຼັກ</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70"><ArrowLeft className="w-4 h-4" /> ກັບ</Link>
          <h1 className="text-xl font-extrabold">Admin Console</h1>
          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-4">
        <div className="inline-flex bg-muted rounded-full p-1">
          <button onClick={() => setTab("users")} className={`px-4 py-1.5 rounded-full text-sm font-bold ${tab === "users" ? "bg-background shadow-soft" : "text-muted-foreground"}`}>ຜູ້ໃຊ້</button>
          <button onClick={() => setTab("codes")} className={`px-4 py-1.5 rounded-full text-sm font-bold ${tab === "codes" ? "bg-background shadow-soft" : "text-muted-foreground"}`}>ໂຄດເຕີມ</button>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        {tab === "users" ? (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(query); }} placeholder="ຄົ້ນຫາ ອີເມວ / ຊື່" className="pl-9" />
              </div>
              <Button onClick={() => search(query)} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "ຄົ້ນຫາ"}</Button>
            </div>

            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {users.map((u) => (
                <UserRow key={u.id} u={u} onGrant={grantPremium} onRevoke={revokePremium} onAdd={addCredits} />
              ))}
              {users.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">ບໍ່ມີຜູ້ໃຊ້</div>}
            </div>
          </div>
        ) : (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex justify-between mb-4">
              <h2 className="font-extrabold">ໂຄດເຕີມທັງໝົດ</h2>
              <Button onClick={() => setShowCreate(true)} size="sm" className="bg-gradient-button text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> ສ້າງໂຄດ</Button>
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {codes.map((c) => <CodeRow key={c.id} c={c} />)}
              {codes.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">ຍັງບໍ່ມີໂຄດ</div>}
            </div>
          </div>
        )}
      </main>

      <CreateCodeDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={loadCodes} />
    </div>
  );
}

function UserRow({ u, onGrant, onRevoke, onAdd }: { u: AdminUser; onGrant: (id: string, d: number) => void; onRevoke: (id: string) => void; onAdd: (id: string, a: number) => void }) {
  const [credit, setCredit] = useState(20);
  const active = u.is_premium && (!u.premium_until || new Date(u.premium_until) > new Date());
  return (
    <div className="border border-border rounded-2xl p-3 bg-white/40">
      <div className="flex items-start gap-3 flex-wrap">
        {u.avatar_url ? <img src={u.avatar_url} className="w-10 h-10 rounded-full" alt="" /> : <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">{(u.email ?? "?")[0].toUpperCase()}</div>}
        <div className="flex-1 min-w-[180px]">
          <div className="font-bold text-sm">{u.full_name ?? "(ບໍ່ມີຊື່)"}</div>
          <div className="text-xs text-muted-foreground">{u.email}</div>
          <div className="flex gap-2 mt-1 text-xs">
            {active && <span className="px-2 py-0.5 rounded-full bg-gradient-premium text-premium-foreground font-bold">PREMIUM{u.premium_until ? ` · ${new Date(u.premium_until).toLocaleDateString()}` : ""}</span>}
            <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-bold">{u.extra_credits} ເຄຣດິດ</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onGrant(u.id, 30)}><Crown className="w-3 h-3 mr-1" /> +30ມື້</Button>
          <Button size="sm" variant="outline" onClick={() => onGrant(u.id, 365)}><Crown className="w-3 h-3 mr-1" /> +1ປີ</Button>
          {active && <Button size="sm" variant="ghost" onClick={() => onRevoke(u.id)}>ຍົກເລີກ</Button>}
        </div>
      </div>
      <div className="flex gap-2 mt-2 items-center">
        <Input type="number" value={credit} onChange={(e) => setCredit(parseInt(e.target.value) || 0)} className="h-8 w-24" />
        <Button size="sm" onClick={() => onAdd(u.id, credit)}>+ ເຄຣດິດ</Button>
        <Button size="sm" variant="ghost" onClick={() => onAdd(u.id, -credit)}>− ເຄຣດິດ</Button>
      </div>
    </div>
  );
}

function CodeRow({ c }: { c: TopupCode }) {
  const [copied, setCopied] = useState(false);
  const used = !!c.used_by;
  function copy() {
    navigator.clipboard.writeText(c.code);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className={`border rounded-2xl p-3 flex items-center gap-3 ${used ? "opacity-50 border-border" : "border-primary/30 bg-white/40"}`}>
      <Ticket className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1">
        <div className="font-mono font-bold tracking-wider">{c.code}</div>
        <div className="text-xs text-muted-foreground">
          {c.credits > 0 && `${c.credits} ເຄຣດິດ `}
          {c.premium_days > 0 && `+ ${c.premium_days} ມື້ Premium `}
          {c.note && `· ${c.note}`}
          {used && ` · ໃຊ້ແລ້ວ ${new Date(c.used_at!).toLocaleDateString()}`}
        </div>
      </div>
      {!used && (
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </Button>
      )}
    </div>
  );
}

function CreateCodeDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [credits, setCredits] = useState(20);
  const [days, setDays] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_topup_code", { p_credits: credits, p_premium_days: days, p_note: note || undefined, p_expires_at: undefined });
    setBusy(false);
    if (error) return toast.error(error.message);
    const r = data as { ok: boolean; code: string };
    setLast(r.code);
    toast.success(`ສ້າງໂຄດສຳເລັດ: ${r.code}`);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ສ້າງໂຄດເຕີມໃໝ່</DialogTitle>
          <DialogDescription>ສ້າງໂຄດໃຫ້ຜູ້ໃຊ້ໄປໃຊ້ຮັບເຄຣດິດ / Premium</DialogDescription>
        </DialogHeader>
        <label className="text-xs font-bold">ເຄຣດິດ</label>
        <Input type="number" value={credits} onChange={(e) => setCredits(parseInt(e.target.value) || 0)} />
        <label className="text-xs font-bold">ມື້ Premium</label>
        <Input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value) || 0)} />
        <label className="text-xs font-bold">ໝາຍເຫດ</label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        <Button onClick={create} disabled={busy} className="bg-gradient-button text-primary-foreground font-bold">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />} ສ້າງ
        </Button>
        {last && <div className="text-center font-mono text-lg p-2 bg-success/10 rounded-xl">{last}</div>}
      </DialogContent>
    </Dialog>
  );
}
