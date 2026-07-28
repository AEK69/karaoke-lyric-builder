import { useEffect, useState } from "react";
import { Bell, Check, X, Crown } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

function fmt(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, meta, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data ?? []) as unknown as NotificationRow[]);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unread = items.filter((n) => !n.read_at).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await supabase.rpc("mark_notifications_read");
      setItems((prev) =>
        prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
      );
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        title="ການແຈ້ງເຕືອນ"
        className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-muted hover:bg-muted/70 flex items-center justify-center transition"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-[19rem] sm:w-80 max-h-96 overflow-y-auto z-50 glass rounded-2xl border border-white/50 shadow-soft p-2">
            <div className="px-2 py-1 text-xs font-extrabold text-muted-foreground">
              ການແຈ້ງເຕືອນ
            </div>
            {items.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-6">
                ຍັງບໍ່ມີການແຈ້ງເຕືອນ
              </div>
            )}
            {items.map((n) => {
              const meta = (n.meta ?? {}) as Record<string, unknown>;
              const from = fmt(meta.premium_from);
              const until = fmt(meta.premium_until);
              const approved = n.kind === "suggestion_approved";
              return (
                <div key={n.id} className="rounded-xl p-2.5 mb-1 bg-white/50 border border-border">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        approved
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {approved ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold break-words">{n.title}</div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground break-words">{n.body}</div>
                      )}
                      {approved && (from || until) && (
                        <div className="mt-1 text-[11px] inline-flex items-start gap-1 text-premium font-semibold">
                          <Crown className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>
                            Premium ຟຣີ 1 ມື້: {from ?? "—"} → {until ?? "—"}
                          </span>
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
