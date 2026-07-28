import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CloudCheck, Loader2, PlusCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { hasWord } from "@/lib/translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  duplicate: "ຄຳສັບນີ້ມີຢູ່ແລ້ວ ຫຼື ກຳລັງລໍຖ້າອະນຸມັດ",
  invalid_input: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ (1-100 ຕົວອັກສອນ)",
  not_lao: "ຊ່ອງພາສາລາວຕ້ອງມີຕົວອັກສອນລາວ",
  invalid_karaoke: "Karaoke ໃຊ້ໄດ້ສະເພາະ a-z, 0-9, ຍະຫວ່າງ, ' ແລະ -",
  rate_limited: "ສົ່ງໄດ້ສູງສຸດ 20 ຄຳ/ວັນ",
  not_authenticated: "ກະລຸນາ Login ກ່ອນ",
};

const LAO_RE = /[຀-໿]/;
const KARAOKE_RE = /^[a-z0-9 '-]+$/;
const LAO_MAX = 100;
const KARA_MAX = 100;
const NOTE_MAX = 300;
const DRAFT_KEY = "kb:suggest-word-draft";

type Draft = { lao: string; karaoke: string; note: string };

function loadDraft(): Draft {
  if (typeof window === "undefined") return { lao: "", karaoke: "", note: "" };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Draft>;
      return { lao: d.lao ?? "", karaoke: d.karaoke ?? "", note: d.note ?? "" };
    }
  } catch {
    /* ignore corrupt draft */
  }
  return { lao: "", karaoke: "", note: "" };
}

export function SuggestWordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lao, setLao] = useState("");
  const [karaoke, setKaraoke] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedDraft, setSavedDraft] = useState(false);
  const karaokeRef = useRef<HTMLInputElement>(null);

  // Restore autosaved draft the first time the dialog is opened.
  const restored = useRef(false);
  useEffect(() => {
    if (!open || restored.current) return;
    restored.current = true;
    const d = loadDraft();
    setLao(d.lao);
    setKaraoke(d.karaoke);
    setNote(d.note);
    if (d.lao || d.karaoke || d.note) setSavedDraft(true);
  }, [open]);

  // Autosave the draft as the user types (debounced), clear storage when emptied.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasContent = Boolean(lao || karaoke || note);
    const t = setTimeout(() => {
      if (hasContent) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ lao, karaoke, note }));
        setSavedDraft(true);
      } else {
        localStorage.removeItem(DRAFT_KEY);
        setSavedDraft(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [lao, karaoke, note]);

  function clearDraft() {
    setLao("");
    setKaraoke("");
    setNote("");
    setSavedDraft(false);
    if (typeof window !== "undefined") localStorage.removeItem(DRAFT_KEY);
  }

  // Live per-field validation — shown inline once a field has content.
  const l = lao.trim();
  const k = karaoke.trim();
  const laoError =
    l && !LAO_RE.test(l)
      ? ERRORS.not_lao
      : l && hasWord(l)
        ? "ຄຳສັບນີ້ມີໃນລະບົບແລ້ວ — ເພີ່ມບໍ່ໄດ້"
        : "";
  const karaokeError = k && !KARAOKE_RE.test(k) ? ERRORS.invalid_karaoke : "";
  const canSubmit = Boolean(l && k && !laoError && !karaokeError && !busy);

  async function submit() {
    if (!l || !k) return toast.error("ກະລຸນາຕື່ມທັງສອງຊ່ອງ");
    if (laoError) return toast.error(laoError);
    if (karaokeError) return toast.error(karaokeError);

    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return toast.error(ERRORS.not_authenticated);

    setBusy(true);
    const { data, error } = await supabase.rpc("submit_word_suggestion", {
      p_lao: l,
      p_karaoke: k.toLowerCase(),
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) return toast.error("ສົ່ງບໍ່ສຳເລັດ", { description: error.message });
    const r = data as { ok: boolean; error?: string };
    if (!r.ok) return toast.error(ERRORS[r.error ?? ""] ?? r.error ?? "ຜິດພາດ");
    toast.success("ສົ່ງແລ້ວ! ຖ້າແອັດມິນອະນຸມັດ ທ່ານຈະໄດ້ Premium ຟຣີ 1 ມື້");
    clearDraft();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-primary" /> ເພີ່ມຄຳສັບ Karaoke
          </DialogTitle>
          <DialogDescription>
            ຄຳທີ່ຍັງບໍ່ມີໃນລະບົບ — ອະນຸມັດແລ້ວໄດ້ Premium ຟຣີ 1 ມື້
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="ຄຳລາວ" count={lao.length} max={LAO_MAX} error={laoError}>
            <Input
              value={lao}
              onChange={(e) => setLao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  karaokeRef.current?.focus();
                }
              }}
              placeholder="ສະບາຍດີ"
              maxLength={LAO_MAX}
              lang="lo"
              autoComplete="off"
              enterKeyHint="next"
              aria-invalid={Boolean(laoError)}
              className={cn(laoError && "border-destructive focus-visible:ring-destructive")}
            />
          </Field>

          <Field
            label="Karaoke"
            count={karaoke.length}
            max={KARA_MAX}
            error={karaokeError}
            hint="ໃຊ້ໄດ້: a-z, 0-9, ຍະຫວ່າງ, ' ແລະ -"
          >
            <Input
              ref={karaokeRef}
              value={karaoke}
              onChange={(e) => setKaraoke(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="sa bai dee"
              maxLength={KARA_MAX}
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-invalid={Boolean(karaokeError)}
              className={cn(karaokeError && "border-destructive focus-visible:ring-destructive")}
            />
          </Field>

          <Field label="ໝາຍເຫດ (ບໍ່ຈຳເປັນ)" count={note.length} max={NOTE_MAX}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              enterKeyHint="done"
            />
          </Field>

          <div className="flex items-center justify-between gap-2 min-h-[1rem]">
            {savedDraft ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CloudCheck className="w-3 h-3 text-success" /> ບັນທຶກຮ່າງອັດຕະໂນມັດແລ້ວ
              </span>
            ) : (
              <span />
            )}
            {(lao || karaoke || note) && (
              <button
                type="button"
                onClick={clearDraft}
                className="text-[11px] font-bold text-muted-foreground hover:text-destructive active:opacity-60"
              >
                ລ້າງ
              </button>
            )}
          </div>

          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full bg-gradient-button text-primary-foreground font-bold disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}{" "}
            ສົ່ງຄຳສັບ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  count,
  max,
  error,
  hint,
  children,
}: {
  label: string;
  count: number;
  max: number;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const near = count >= max * 0.9;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-bold text-muted-foreground">{label}</label>
        <span
          className={cn(
            "text-[11px] tabular-nums",
            near ? "text-destructive font-bold" : "text-muted-foreground/70",
          )}
        >
          {count}/{max}
        </span>
      </div>
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  );
}
