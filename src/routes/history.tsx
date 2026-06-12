import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2, Loader2, History as HistoryIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "ປະຫວັດການແປ — Lao Karaoke" }] }),
  component: HistoryPage,
});

interface Row {
  id: string;
  direction: string;
  input_text: string;
  output_text: string;
  created_at: string;
}

function HistoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalToday, setTotalToday] = useState(0);

  async function load() {
    setLoading(true);
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setLoading(false); return; }
    const { data } = await supabase.from("translation_history")
      .select("*").order("created_at", { ascending: false }).limit(200);
    setRows((data ?? []) as Row[]);
    const today = new Date().toISOString().slice(0, 10);
    const { data: u } = await supabase.from("daily_usage").select("count")
      .eq("user_id", s.session.user.id).eq("used_date", today).maybeSingle();
    setTotalToday((u as { count: number } | null)?.count ?? 0);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function del(id: string) {
    const { error } = await supabase.from("translation_history").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70"><ArrowLeft className="w-4 h-4" /> ກັບ</Link>
          <h1 className="text-xl font-extrabold flex items-center gap-2"><HistoryIcon className="w-5 h-5 text-primary" /> ປະຫວັດການແປ</h1>
          <div className="w-16" />
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
        <div className="glass rounded-2xl p-4 mb-4 flex items-center justify-between border border-white/40">
          <div className="text-sm">ໃຊ້ໄປວັນນີ້: <span className="font-extrabold text-primary">{totalToday}</span> ຄັ້ງ</div>
          <div className="text-sm text-muted-foreground">ທັງໝົດ: {rows.length} ລາຍການ</div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">ຍັງບໍ່ມີປະຫວັດ</div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="glass rounded-2xl p-4 border border-white/40 shadow-soft">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div className="text-xs font-bold text-muted-foreground">
                    {r.direction === "lao-to-karaoke" ? "ລາວ → Karaoke" : "Karaoke → ລາວ"}
                    <span className="mx-2">·</span>
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                  <button onClick={() => del(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-muted/40 p-2 whitespace-pre-wrap break-words">{r.input_text}</div>
                  <div className="rounded-xl bg-gradient-to-br from-primary/5 to-accent/5 p-2 whitespace-pre-wrap break-words border border-primary/15">{r.output_text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
