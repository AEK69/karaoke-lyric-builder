import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Coins,
  CreditCard,
  Building2,
  Calendar,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface PaymentItem {
  id: string;
  plan_label: string;
  amount: number;
  credits?: number;
  premium_days?: number;
  status: string;
  admin_note?: string | null;
  bank?: string;
  time?: string;
  created_at: string;
}

interface PaymentHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  userId?: string;
}

export function PaymentHistoryDialog({ open, onClose, userId }: PaymentHistoryDialogProps) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<PaymentItem[]>([]);

  useEffect(() => {
    if (!open || !userId) return;

    const currentUid = userId;
    let active = true;
    setLoading(true);

    async function fetchHistory() {
      // 1. Read local cache
      let localList: PaymentItem[] = [];
      try {
        const raw = localStorage.getItem(`kb:user_payments_${currentUid}`);
        if (raw) localList = JSON.parse(raw);
      } catch {
        // Safe
      }

      // 2. Read from Supabase DB
      let dbList: PaymentItem[] = [];
      try {
        const { data } = await supabase
          .from("payment_requests")
          .select("id, plan_label, amount, credits, premium_days, status, admin_note, created_at")
          .eq("user_id", currentUid)
          .order("created_at", { ascending: false })
          .limit(20);

        if (data) dbList = data as PaymentItem[];
      } catch {
        // Safe
      }

      if (!active) return;

      // Merge unique by id
      const seen = new Set<string>();
      const combined: PaymentItem[] = [];

      for (const item of [...dbList, ...localList]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          combined.push(item);
        }
      }

      // Sort newest first
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setHistory(combined);
      setLoading(false);
    }

    void fetchHistory();

    return () => {
      active = false;
    };
  }, [open, userId]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-5 rounded-3xl">
        <DialogHeader className="mb-3">
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold">
            <Coins className="w-5 h-5 text-primary" />
            <span>ປະຫວັດການເຕີມເຄຣດິດ</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            ລາຍການຊຳລະເງິນ ແລະ ເຕີມເຄຣດິດທັງໝົດໃນບັນຊີຂອງທ່ານ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
              ກຳລັງໂຫຼດຂໍ້ມູນ...
            </div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-2 text-muted-foreground">
                <CreditCard className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-foreground">ຍັງບໍ່ມີປະຫວັດການເຕີມເງິນ</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                ເລືອກແພັກເກັດ ຫຼື ກຳນົດຈຳນວນເຄຣດິດເພື່ອເຕີມເຂົ້າບັນຊີໄດ້ທັນທີ
              </p>
            </div>
          ) : (
            history.map((item) => {
              const isApproved = item.status === "approved" || item.status === "paid";
              const isPending = item.status === "pending";
              const isExpired = item.status === "expired";
              const isRejected = item.status === "rejected";

              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border/50 bg-muted/20 p-3 text-xs space-y-1.5 transition hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-foreground truncate">
                      {item.plan_label}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        isApproved
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : isPending
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : isExpired
                              ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                      }`}
                    >
                      {isApproved && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {isPending && <Clock className="w-2.5 h-2.5" />}
                      {isExpired && <AlertCircle className="w-2.5 h-2.5" />}
                      {isRejected && <XCircle className="w-2.5 h-2.5" />}
                      <span>
                        {isApproved
                          ? "ສຳເລັດ"
                          : isPending
                            ? "ລໍຖ້າ"
                            : isExpired
                              ? "ໝົດອາຍຸ"
                              : "ຍົກເລີກ"}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono font-bold text-foreground">
                      {item.amount.toLocaleString()} ກີບ
                    </span>
                    <span>
                      {new Date(item.created_at).toLocaleString("lo-LA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>

                  {(item.bank || item.admin_note) && (
                    <div className="text-[10px] text-muted-foreground bg-background/50 rounded-lg p-1.5 font-mono truncate">
                      {item.bank ? `ທະນາຄານ: ${item.bank}` : item.admin_note}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            ປິດ
          </Button>
          <Link
            to="/payment"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-soft hover:opacity-90 transition"
          >
            <span>ເຕີມເຄຣດິດເພີ່ມ</span>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
