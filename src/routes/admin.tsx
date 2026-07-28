import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Crown,
  Plus,
  Search,
  Loader2,
  Copy,
  Check,
  Ticket,
  CreditCard,
  RotateCcw,
  Filter,
  Trash2,
  BarChart3,
  Languages,
  Users,
  Coins,
  X,
  ScrollText,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
  used_today: number;
  free_remaining: number;
  total_translations: number;
}

interface TopupCode {
  id: string;
  code: string;
  credits: number;
  premium_days: number;
  note: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at: string;
}

interface PaymentRow {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  amount: number;
  plan_label: string;
  credits: number;
  premium_days: number;
  slip_url: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface Suggestion {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  lao_word: string;
  karaoke_word: string;
  note: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface StatsSeries {
  day: string;
  translations: number;
  new_users: number;
  words: number;
}
interface Stats {
  total_users: number;
  premium_users: number;
  new_users_7d: number;
  translations_total: number;
  translations_today: number;
  pending_payments: number;
  pending_words: number;
  approved_words: number;
  revenue_total: number;
  active_codes: number;
  series: StatsSeries[];
}

interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

type UserFilter = "all" | "premium" | "free";
type CodeFilter = "all" | "unused" | "used" | "expired";
type PaymentFilter = "pending" | "approved" | "rejected" | "all";
type WordFilter = "pending" | "approved" | "rejected" | "all";

function AdminPage() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"stats" | "users" | "codes" | "payments" | "words" | "audit">(
    "stats",
  );

  // Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [loading, setLoading] = useState(false);

  // Codes
  const [codes, setCodes] = useState<TopupCode[]>([]);
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all");
  const [showCreate, setShowCreate] = useState(false);

  // Payments
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("pending");

  // Words + stats
  const [words, setWords] = useState<Suggestion[]>([]);
  const [wordFilter, setWordFilter] = useState<WordFilter>("pending");
  const [stats, setStats] = useState<Stats | null>(null);

  // Audit log
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [topWords, setTopWords] = useState<Array<{ word: string; uses: number }>>([]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        navigate({ to: "/" });
        return;
      }
      const { data: r } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", s.session.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!r) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      void loadStats();
      void search("");
      void loadCodes("all");
      void loadPayments("pending");
      void loadWords("pending");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStats() {
    const { data, error } = await supabase.rpc("admin_stats", { p_days: 14 });
    if (error) {
      toast.error(error.message);
      return;
    }
    setStats(data as unknown as Stats);
    const { data: top } = await supabase.rpc("public_top_words", { p_days: 14, p_limit: 10 });
    setTopWords((top ?? []).map((r) => ({ word: r.word, uses: Number(r.uses) })));
  }

  async function loadAudit() {
    const { data, error } = await supabase.rpc("admin_list_audit_logs", { p_limit: 200 });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAudit((data ?? []) as unknown as AuditRow[]);
  }

  async function loadWords(f: WordFilter) {
    const { data, error } = await supabase.rpc("admin_list_suggestions", { p_status: f });
    if (error) {
      toast.error(error.message);
      return;
    }
    setWords((data ?? []) as Suggestion[]);
  }

  async function reviewWord(id: string, approve: boolean) {
    const note = approve ? null : (prompt("ເຫດຜົນປະຕິເສດ (ບໍ່ຈຳເປັນ)") ?? null);
    const { data, error } = await supabase.rpc("admin_review_suggestion", {
      p_id: id,
      p_approve: approve,
      p_note: note ?? undefined,
    });
    if (error) return toast.error(error.message);
    const r = data as { ok: boolean; error?: string };
    if (!r.ok) return toast.error(r.error ?? "ຜິດພາດ");
    toast.success(approve ? "ອະນຸມັດແລ້ວ — ຜູ້ສົ່ງໄດ້ Premium 1 ມື້" : "ປະຕິເສດແລ້ວ");
    void loadWords(wordFilter);
    void loadStats();
  }

  async function search(q: string) {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_search_users", { p_query: q });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setUsers((data ?? []) as AdminUser[]);
  }

  async function loadCodes(f: CodeFilter) {
    const { data, error } = await supabase.rpc("admin_list_topup_codes", { p_filter: f });
    if (error) {
      toast.error(error.message);
      return;
    }
    setCodes((data ?? []) as TopupCode[]);
  }

  async function deleteCode(id: string) {
    if (!confirm("ລຶບໂຄດນີ້ຖາວອນ?")) return;
    const { error } = await supabase.rpc("admin_delete_topup_code", { p_id: id });
    if (error) {
      toast.error("ລຶບລົ້ມເຫຼວ", { description: error.message });
      return;
    }
    toast.success("ລຶບໂຄດແລ້ວ");
    void loadCodes(codeFilter);
  }

  async function loadPayments(f: PaymentFilter) {
    const { data, error } = await supabase.rpc("admin_list_payments", { p_status: f });
    if (error) {
      toast.error(error.message);
      return;
    }
    setPayments((data ?? []) as PaymentRow[]);
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
  async function resetCredits(userId: string) {
    if (!confirm("ຣີເຊັດເຄຣດິດ ແລະ ລ້າງການໃຊ້ງານວັນນີ້?")) return;
    const { error } = await supabase.rpc("admin_reset_credits", { p_user: userId });
    if (error) return toast.error(error.message);
    toast.success("ຣີເຊັດແລ້ວ");
    void search(query);
  }

  async function approvePayment(id: string) {
    const note = prompt("ໝາຍເຫດ (ບໍ່ຈຳເປັນ)") ?? null;
    const { data, error } = await supabase.rpc("admin_approve_payment", {
      p_id: id,
      p_note: note ?? undefined,
    });
    if (error) return toast.error(error.message);
    const r = data as { ok: boolean; error?: string };
    if (!r.ok) return toast.error(r.error ?? "ຜິດພາດ");
    toast.success("ອະນຸມັດ ແລະ ເຕີມໃຫ້ຜູ້ໃຊ້ແລ້ວ");
    void loadPayments(paymentFilter);
  }
  async function rejectPayment(id: string) {
    const note = prompt("ເຫດຜົນປະຕິເສດ:") ?? null;
    const { error } = await supabase.rpc("admin_reject_payment", {
      p_id: id,
      p_note: note ?? undefined,
    });
    if (error) return toast.error(error.message);
    toast.success("ປະຕິເສດແລ້ວ");
    void loadPayments(paymentFilter);
  }

  const filteredUsers = users.filter((u) => {
    const active = u.is_premium && (!u.premium_until || new Date(u.premium_until) > new Date());
    if (userFilter === "premium") return active;
    if (userFilter === "free") return !active;
    return true;
  });

  if (authorized === null)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  if (!authorized)
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-3xl p-8 text-center max-w-sm">
          <h2 className="text-xl font-extrabold mb-2">ບໍ່ມີສິດເຂົ້າເຖິງ</h2>
          <Link to="/">
            <Button>ກັບໜ້າຫຼັກ</Button>
          </Link>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="sticky top-0 z-30 px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-6xl mx-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm font-bold active:opacity-60"
          >
            <ArrowLeft className="w-4 h-4" /> ກັບ
          </Link>
          <h1 className="text-base sm:text-xl font-extrabold text-center truncate">
            Admin Console
          </h1>
          <div className="w-8" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 my-3 overflow-x-auto no-scrollbar">
        <div className="inline-flex bg-muted rounded-full p-1 whitespace-nowrap">
          <TabBtn
            active={tab === "stats"}
            onClick={() => {
              setTab("stats");
              void loadStats();
            }}
          >
            <BarChart3 className="w-3 h-3 inline mr-1" /> ສະຖິຕິ
          </TabBtn>
          <TabBtn active={tab === "users"} onClick={() => setTab("users")}>
            ຜູ້ໃຊ້
          </TabBtn>
          <TabBtn
            active={tab === "payments"}
            onClick={() => {
              setTab("payments");
              void loadPayments(paymentFilter);
            }}
          >
            <CreditCard className="w-3 h-3 inline mr-1" /> ການຈ່າຍ
          </TabBtn>
          <TabBtn
            active={tab === "codes"}
            onClick={() => {
              setTab("codes");
              void loadCodes(codeFilter);
            }}
          >
            ໂຄດເຕີມ
          </TabBtn>
          <TabBtn
            active={tab === "words"}
            onClick={() => {
              setTab("words");
              void loadWords(wordFilter);
            }}
          >
            <Languages className="w-3 h-3 inline mr-1" /> ຄຳສັບ
            {stats && stats.pending_words > 0 ? ` (${stats.pending_words})` : ""}
          </TabBtn>
          <TabBtn
            active={tab === "audit"}
            onClick={() => {
              setTab("audit");
              void loadAudit();
            }}
          >
            <ScrollText className="w-3 h-3 inline mr-1" /> Audit Log
          </TabBtn>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        {tab === "stats" && <StatsPanel stats={stats} topWords={topWords} />}

        {tab === "audit" && (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-extrabold">ບັນທຶກການດຳເນີນງານ (Audit Log)</div>
              <button
                onClick={() => void loadAudit()}
                className="text-xs font-bold text-primary inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> ໂຫຼດໃໝ່
              </button>
            </div>
            <div className="space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-white/50 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                      {a.action}
                    </span>
                    <span className="font-semibold">{a.actor_email ?? "system"}</span>
                    {a.target_email && (
                      <span className="text-muted-foreground">→ {a.target_email}</span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  {a.details && (
                    <pre className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                      {JSON.stringify(a.details)}
                    </pre>
                  )}
                </div>
              ))}
              {audit.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">ຍັງບໍ່ມີບັນທຶກ</div>
              )}
            </div>
          </div>
        )}

        {tab === "words" && (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex gap-1 mb-3 text-xs flex-wrap">
              {(["pending", "approved", "rejected", "all"] as WordFilter[]).map((f) => (
                <FilterPill
                  key={f}
                  active={wordFilter === f}
                  onClick={() => {
                    setWordFilter(f);
                    void loadWords(f);
                  }}
                >
                  {f === "pending"
                    ? "ລໍຖ້າ"
                    : f === "approved"
                      ? "ອະນຸມັດແລ້ວ"
                      : f === "rejected"
                        ? "ປະຕິເສດ"
                        : "ທັງໝົດ"}
                </FilterPill>
              ))}
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {words.map((w) => (
                <div
                  key={w.id}
                  className="border border-border rounded-2xl p-3 bg-white/40 flex justify-between items-start gap-3 flex-wrap"
                >
                  <div className="min-w-[200px]">
                    <div className="font-bold">
                      {w.lao_word} <span className="text-muted-foreground">→</span>{" "}
                      <span className="text-primary">{w.karaoke_word}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {w.full_name ?? w.email} · {new Date(w.created_at).toLocaleString()}
                    </div>
                    {w.note && <div className="text-xs mt-1">“{w.note}”</div>}
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold ${w.status === "pending" ? "bg-yellow-100 text-yellow-800" : w.status === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                    >
                      {w.status}
                    </span>
                  </div>
                  {w.status === "pending" && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="bg-success text-success-foreground"
                        onClick={() => reviewWord(w.id, true)}
                      >
                        <Check className="w-3 h-3 mr-1" /> ອະນຸມັດ
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => reviewWord(w.id, false)}>
                        <X className="w-3 h-3 mr-1" /> ປະຕິເສດ
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {words.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">ບໍ່ມີຄຳສັບ</div>
              )}
            </div>
          </div>
        )}

        {tab === "users" && (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex gap-2 mb-3 flex-wrap">
              <div className="flex-1 relative min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") search(query);
                  }}
                  placeholder="ຄົ້ນຫາ ອີເມວ / ຊື່"
                  className="pl-9"
                />
              </div>
              <Button onClick={() => search(query)} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "ຄົ້ນຫາ"}
              </Button>
            </div>
            <div className="flex gap-1 mb-3 text-xs">
              <FilterPill active={userFilter === "all"} onClick={() => setUserFilter("all")}>
                ທັງໝົດ ({users.length})
              </FilterPill>
              <FilterPill
                active={userFilter === "premium"}
                onClick={() => setUserFilter("premium")}
              >
                Premium
              </FilterPill>
              <FilterPill active={userFilter === "free"} onClick={() => setUserFilter("free")}>
                Free
              </FilterPill>
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {filteredUsers.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  onGrant={grantPremium}
                  onRevoke={revokePremium}
                  onAdd={addCredits}
                  onReset={resetCredits}
                />
              ))}
              {filteredUsers.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">ບໍ່ມີຜູ້ໃຊ້</div>
              )}
            </div>
          </div>
        )}

        {tab === "payments" && (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex gap-1 mb-3 text-xs flex-wrap">
              {(["pending", "approved", "rejected", "all"] as PaymentFilter[]).map((f) => (
                <FilterPill
                  key={f}
                  active={paymentFilter === f}
                  onClick={() => {
                    setPaymentFilter(f);
                    void loadPayments(f);
                  }}
                >
                  {f === "pending"
                    ? "ລໍຖ້າ"
                    : f === "approved"
                      ? "ອະນຸມັດແລ້ວ"
                      : f === "rejected"
                        ? "ປະຕິເສດ"
                        : "ທັງໝົດ"}
                </FilterPill>
              ))}
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="border border-border rounded-2xl p-3 bg-white/40">
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-bold text-sm">{p.full_name ?? p.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.email} · {new Date(p.created_at).toLocaleString()}
                      </div>
                      <div className="text-sm mt-1">
                        <span className="font-extrabold text-primary">
                          {p.amount.toLocaleString()} ກີບ
                        </span>
                        <span className="mx-1">·</span>
                        {p.plan_label}
                        {p.credits > 0 && (
                          <span className="ml-2 text-accent">+{p.credits} ເຄຣດິດ</span>
                        )}
                        {p.premium_days > 0 && (
                          <span className="ml-2 text-premium">+{p.premium_days} ມື້</span>
                        )}
                      </div>
                      <div className="text-xs mt-1">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${p.status === "pending" ? "bg-yellow-100 text-yellow-800" : p.status === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                        >
                          {p.status}
                        </span>
                        {p.admin_note && (
                          <span className="ml-2 text-muted-foreground">"{p.admin_note}"</span>
                        )}
                      </div>
                    </div>
                    {p.status === "pending" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => approvePayment(p.id)}
                          className="bg-success text-success-foreground"
                        >
                          <Check className="w-3 h-3 mr-1" /> ອະນຸມັດ
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => rejectPayment(p.id)}>
                          ປະຕິເສດ
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {payments.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">ບໍ່ມີລາຍການ</div>
              )}
            </div>
          </div>
        )}

        {tab === "codes" && (
          <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
            <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
              <div className="flex gap-1 text-xs flex-wrap">
                {(["all", "unused", "used", "expired"] as CodeFilter[]).map((f) => (
                  <FilterPill
                    key={f}
                    active={codeFilter === f}
                    onClick={() => {
                      setCodeFilter(f);
                      void loadCodes(f);
                    }}
                  >
                    {f === "all"
                      ? "ທັງໝົດ"
                      : f === "unused"
                        ? "ຍັງບໍ່ໃຊ້"
                        : f === "used"
                          ? "ໃຊ້ແລ້ວ"
                          : "ໝົດອາຍຸ"}
                  </FilterPill>
                ))}
              </div>
              <Button
                onClick={() => setShowCreate(true)}
                size="sm"
                className="bg-gradient-button text-primary-foreground"
              >
                <Plus className="w-4 h-4 mr-1" /> ສ້າງໂຄດ
              </Button>
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {codes.map((c) => (
                <CodeRow key={c.id} c={c} onDelete={deleteCode} />
              ))}
              {codes.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">ບໍ່ມີໂຄດ</div>
              )}
            </div>
          </div>
        )}
      </main>

      <CreateCodeDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => loadCodes(codeFilter)}
      />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-bold ${active ? "bg-background shadow-soft" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full font-bold transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
    >
      {children}
    </button>
  );
}

function UserRow({
  u,
  onGrant,
  onRevoke,
  onAdd,
  onReset,
}: {
  u: AdminUser;
  onGrant: (id: string, d: number) => void;
  onRevoke: (id: string) => void;
  onAdd: (id: string, a: number) => void;
  onReset: (id: string) => void;
}) {
  const [credit, setCredit] = useState(20);
  const active = u.is_premium && (!u.premium_until || new Date(u.premium_until) > new Date());
  return (
    <div className="border border-border rounded-2xl p-3 bg-white/40">
      <div className="flex items-start gap-3 flex-wrap">
        {u.avatar_url ? (
          <img src={u.avatar_url} className="w-10 h-10 rounded-full" alt="" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">
            {(u.email ?? "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-[180px]">
          <div className="font-bold text-sm">{u.full_name ?? "(ບໍ່ມີຊື່)"}</div>
          <div className="text-xs text-muted-foreground">{u.email}</div>
          <div className="flex gap-2 mt-1 text-xs flex-wrap">
            {active && (
              <span className="px-2 py-0.5 rounded-full bg-gradient-premium text-premium-foreground font-bold">
                PREMIUM
                {u.premium_until ? ` · ${new Date(u.premium_until).toLocaleDateString()}` : ""}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-bold">
              {u.extra_credits} ເຄຣດິດ
            </span>
            <span
              title="ການໃຊ້ງານຟຣີມື້ນີ້"
              className={`px-2 py-0.5 rounded-full font-bold ${u.free_remaining === 0 && !active ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
            >
              ມື້ນີ້ {u.used_today}/15 · ເຫຼືອຟຣີ {u.free_remaining < 0 ? "∞" : u.free_remaining}
            </span>
            <span
              className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-bold"
              title="ແປທັງໝົດຕະຫຼອດ"
            >
              ລວມ {Number(u.total_translations).toLocaleString()} ຄັ້ງ
            </span>
          </div>
          {!active && (
            <div className="mt-1.5 h-1.5 w-full max-w-[220px] rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-button"
                style={{ width: `${Math.min(100, (u.used_today / 15) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onGrant(u.id, 30)}>
            <Crown className="w-3 h-3 mr-1" /> +30ມື້
          </Button>
          <Button size="sm" variant="outline" onClick={() => onGrant(u.id, 365)}>
            <Crown className="w-3 h-3 mr-1" /> +1ປີ
          </Button>
          {active && (
            <Button size="sm" variant="ghost" onClick={() => onRevoke(u.id)}>
              ຍົກເລີກ
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-2 items-center flex-wrap">
        <Input
          type="number"
          value={credit}
          onChange={(e) => setCredit(parseInt(e.target.value) || 0)}
          className="h-8 w-24"
        />
        <Button size="sm" onClick={() => onAdd(u.id, credit)}>
          + ເຄຣດິດ
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAdd(u.id, -credit)}>
          − ເຄຣດິດ
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onReset(u.id)}
          title="ຣີເຊັດເຄຣດິດ ແລະ ການໃຊ້ງານວັນນີ້"
        >
          <RotateCcw className="w-3 h-3 mr-1" /> ຣີເຊັດ
        </Button>
      </div>
    </div>
  );
}

function CodeRow({ c, onDelete }: { c: TopupCode; onDelete: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const usedUp = c.max_uses != null && c.use_count >= c.max_uses;
  const expired = !usedUp && c.expires_at && new Date(c.expires_at) < new Date();
  const usageLabel = c.max_uses == null ? `${c.use_count}/∞` : `${c.use_count}/${c.max_uses}`;
  function copy() {
    navigator.clipboard.writeText(c.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div
      className={`border rounded-2xl p-3 flex items-center gap-3 ${usedUp || expired ? "opacity-50 border-border" : "border-primary/30 bg-white/40"}`}
    >
      <Ticket className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1">
        <div className="font-mono font-bold tracking-wider">{c.code}</div>
        <div className="text-xs text-muted-foreground">
          {c.credits > 0 && `${c.credits} ເຄຣດິດ `}
          {c.premium_days > 0 && `+ ${c.premium_days} ມື້ Premium `}
          {c.note && `· ${c.note}`}
          {` · ໃຊ້ ${usageLabel} ຄົນ`}
          {usedUp && ` · ໃຊ້ຄົບແລ້ວ`}
          {expired && ` · ໝົດອາຍຸ`}
        </div>
      </div>
      {!usedUp && !expired && (
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDelete(c.id)}
        title="ລຶບໂຄດ"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

function CreateCodeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [credits, setCredits] = useState(20);
  const [days, setDays] = useState(0);
  const [note, setNote] = useState("");
  const [count, setCount] = useState(1);
  const [maxUses, setMaxUses] = useState(1);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string[]>([]);

  async function create() {
    setBusy(true);
    setLast([]);
    const codes: string[] = [];
    for (let i = 0; i < Math.max(1, Math.min(50, count)); i++) {
      const { data, error } = await supabase.rpc("admin_create_topup_code", {
        p_credits: credits,
        p_premium_days: days,
        p_note: note || undefined,
        p_expires_at: undefined,
        p_max_uses: maxUses,
      });
      if (error) {
        toast.error(error.message);
        break;
      }
      const r = data as { ok: boolean; code: string };
      codes.push(r.code);
    }
    setBusy(false);
    setLast(codes);
    toast.success(`ສ້າງ ${codes.length} ໂຄດ`);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ສ້າງໂຄດເຕີມໃໝ່</DialogTitle>
          <DialogDescription>ສ້າງໂຄດໃຫ້ຜູ້ໃຊ້ໄປໃຊ້ຮັບເຄຣດິດ / Premium</DialogDescription>
        </DialogHeader>
        <label className="text-xs font-bold">ເຄຣດິດຕໍ່ໂຄດ</label>
        <Input
          type="number"
          value={credits}
          onChange={(e) => setCredits(parseInt(e.target.value) || 0)}
        />
        <label className="text-xs font-bold">ມື້ Premium ຕໍ່ໂຄດ</label>
        <Input
          type="number"
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value) || 0)}
        />
        <label className="text-xs font-bold">ຈຳນວນໂຄດ (1-50)</label>
        <Input
          type="number"
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value) || 1)}
        />
        <label className="text-xs font-bold">ໃຊ້ໄດ້ກີ່ຄົນຕໍ່ໂຄດ (0 = ບໍ່ຈຳກັດ)</label>
        <Input
          type="number"
          min={0}
          value={maxUses}
          onChange={(e) => setMaxUses(Math.max(0, parseInt(e.target.value) || 0))}
        />
        <label className="text-xs font-bold">ໝາຍເຫດ</label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        <Button
          onClick={create}
          disabled={busy}
          className="bg-gradient-button text-primary-foreground font-bold"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}{" "}
          ສ້າງ
        </Button>
        {last.length > 0 && (
          <div className="p-2 bg-success/10 rounded-xl max-h-40 overflow-y-auto space-y-1">
            {last.map((c) => (
              <div key={c} className="font-mono text-sm">
                {c}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 border border-white/40 shadow-soft">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl mb-2 ${tone}`}>
        {icon}
      </div>
      <div className="text-2xl font-extrabold leading-none">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function StatsPanel({
  stats,
  topWords = [],
}: {
  stats: Stats | null;
  topWords?: Array<{ word: string; uses: number }>;
}) {
  if (!stats)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  const series = (stats.series ?? []).map((s) => ({ ...s, label: String(s.day).slice(5) }));
  return (
    <div className="space-y-4">
      {topWords.length > 0 && (
        <div className="glass rounded-3xl p-4 sm:p-6 shadow-soft border border-white/40">
          <div className="text-sm font-extrabold mb-3">ຄຳຍອດນິຍົມ 14 ມື້</div>
          <div className="flex flex-wrap gap-2">
            {topWords.map((w) => (
              <span
                key={w.word}
                className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold"
              >
                {w.word} · {w.uses}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="ຜູ້ໃຊ້ທັງໝົດ"
          value={stats.total_users}
          icon={<Users className="w-4 h-4 text-primary" />}
          tone="bg-primary/15"
        />
        <StatCard
          label="Premium ໃຊ້ງານຢູ່"
          value={stats.premium_users}
          icon={<Crown className="w-4 h-4 text-premium" />}
          tone="bg-premium/15"
        />
        <StatCard
          label="ແປວັນນີ້"
          value={stats.translations_today}
          icon={<Languages className="w-4 h-4 text-accent" />}
          tone="bg-accent/15"
        />
        <StatCard
          label="ແປທັງໝົດ"
          value={stats.translations_total}
          icon={<BarChart3 className="w-4 h-4 text-primary" />}
          tone="bg-primary/15"
        />
        <StatCard
          label="ລາຍຮັບ (ກີບ)"
          value={stats.revenue_total}
          icon={<Coins className="w-4 h-4 text-success" />}
          tone="bg-success/15"
        />
        <StatCard
          label="ຈ່າຍລໍຖ້າ"
          value={stats.pending_payments}
          icon={<CreditCard className="w-4 h-4 text-accent" />}
          tone="bg-accent/15"
        />
        <StatCard
          label="ຄຳສັບລໍຖ້າ"
          value={stats.pending_words}
          icon={<Languages className="w-4 h-4 text-premium" />}
          tone="bg-premium/15"
        />
        <StatCard
          label="ໂຄດໃຊ້ໄດ້"
          value={stats.active_codes}
          icon={<Ticket className="w-4 h-4 text-primary" />}
          tone="bg-primary/15"
        />
      </div>

      <div className="glass rounded-3xl p-4 sm:p-6 border border-white/40 shadow-soft">
        <div className="text-sm font-extrabold mb-3">ການແປ 14 ມື້ຫຼ້າສຸດ</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="translations"
                name="ການແປ"
                stroke="hsl(var(--primary))"
                fill="url(#tGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass rounded-3xl p-4 sm:p-6 border border-white/40 shadow-soft">
        <div className="text-sm font-extrabold mb-3">ຜູ້ໃຊ້ໃໝ່ ແລະ ຄຳສັບໃໝ່</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip />
              <Bar
                dataKey="new_users"
                name="ຜູ້ໃຊ້ໃໝ່"
                fill="hsl(var(--accent))"
                radius={[6, 6, 0, 0]}
              />
              <Bar
                dataKey="words"
                name="ຄຳສັບໃໝ່"
                fill="hsl(var(--primary))"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
