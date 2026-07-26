import { useState } from "react";
import { Loader2, PlusCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { hasWord } from "@/lib/translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const ERRORS: Record<string, string> = {
  duplicate: "ຄຳສັບນີ້ມີຢູ່ແລ້ວ ຫຼື ກຳລັງລໍຖ້າອະນຸມັດ",
  invalid_input: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ",
  not_lao: "ຊ່ອງພາສາລາວຕ້ອງເປັນຕົວອັກສອນລາວ",
  invalid_karaoke: "Karaoke ຕ້ອງເປັນ a-z ເທົ່ານັ້ນ",
  rate_limited: "ສົ່ງໄດ້ສູງສຸດ 20 ຄຳ/ວັນ",
};

export function SuggestWordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lao, setLao] = useState("");
  const [karaoke, setKaraoke] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const l = lao.trim();
    const k = karaoke.trim().toLowerCase();
    if (!l || !k) return toast.error("ກະລຸນາຕື່ມທັງສອງຊ່ອງ");
    if (hasWord(l)) return toast.error("ຄຳສັບນີ້ມີໃນລະບົບແລ້ວ — ເພີ່ມບໍ່ໄດ້");
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_word_suggestion", {
      p_lao: l,
      p_karaoke: k,
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const r = data as { ok: boolean; error?: string };
    if (!r.ok) return toast.error(ERRORS[r.error ?? ""] ?? r.error ?? "ຜິດພາດ");
    toast.success("ສົ່ງແລ້ວ! ຖ້າແອັດມິນອະນຸມັດ ທ່ານຈະໄດ້ Premium ຟຣີ 1 ມື້");
    setLao(""); setKaraoke(""); setNote("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlusCircle className="w-4 h-4 text-primary" /> ເພີ່ມຄຳສັບ Karaoke</DialogTitle>
          <DialogDescription>ຄຳທີ່ຍັງບໍ່ມີໃນລະບົບ — ອະນຸມັດແລ້ວໄດ້ Premium ຟຣີ 1 ມື້</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground">ຄຳລາວ</label>
            <Input value={lao} onChange={(e) => setLao(e.target.value)} placeholder="ສະບາຍດີ" maxLength={100} />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Karaoke</label>
            <Input value={karaoke} onChange={(e) => setKaraoke(e.target.value)} placeholder="sa bai dee" maxLength={100} />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">ໝາຍເຫດ (ບໍ່ຈຳເປັນ)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full bg-gradient-button text-primary-foreground font-bold">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} ສົ່ງຄຳສັບ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
