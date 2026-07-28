import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Code2 } from "lucide-react";

export const Route = createFileRoute("/api-docs")({
  head: () => ({
    meta: [
      { title: "API ແປລາວ ↔ Karaoke — Lao Karaoke" },
      { name: "description", content: "ເອກະສານ API ຟຣີ ສຳລັບແປພາສາລາວເປັນ Karaoke ແລະ ກັບຄືນ" },
      { property: "og:title", content: "Lao Karaoke Translation API" },
      { property: "og:description", content: "REST API ຟຣີ ສຳລັບແປລາວ ↔ Karaoke" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApiDocs,
});

const BASE = "https://karaoke-aek.online/api/public/translate";

function Block({ title, code }: { title: string; code: string }) {
  return (
    <div className="mb-5">
      <div className="text-xs font-bold text-muted-foreground mb-1">{title}</div>
      <pre className="rounded-2xl bg-foreground/90 text-background text-xs p-4 overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

function ApiDocs() {
  return (
    <div className="min-h-screen">
      <header className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-70"
          >
            <ArrowLeft className="w-4 h-4" /> ກັບ
          </Link>
          <h1 className="text-xl font-extrabold inline-flex items-center gap-2">
            <Code2 className="w-5 h-5 text-primary" /> API
          </h1>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
        <div className="glass rounded-3xl p-5 sm:p-7 border border-white/40 dark:border-white/10 shadow-soft">
          <p className="text-sm text-muted-foreground mb-5">
            ໃຊ້ໄດ້ຟຣີ, ບໍ່ຕ້ອງມີ API key, ຮອງຮັບ CORS ທຸກໂດເມນ. ຂໍ້ຄວາມສູງສຸດ 5,000
            ຕົວອັກສອນຕໍ່ຄັ້ງ.
          </p>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-6 text-sm break-all">
            <span className="font-mono font-bold text-primary">GET / POST</span> {BASE}
          </div>

          <h2 className="font-extrabold mb-2">ພາຣາມິເຕີ</h2>
          <ul className="text-sm mb-6 space-y-1">
            <li>
              <code className="font-mono font-bold">text</code> — ຂໍ້ຄວາມທີ່ຕ້ອງການແປ (ຈຳເປັນ)
            </li>
            <li>
              <code className="font-mono font-bold">direction</code> — <code>lao-to-karaoke</code>{" "}
              (ຄ່າເລີ່ມຕົ້ນ) ຫຼື <code>karaoke-to-lao</code>
            </li>
          </ul>

          <Block title="GET" code={`curl "${BASE}?text=ສະບາຍດີ&direction=lao-to-karaoke"`} />
          <Block
            title="POST"
            code={`curl -X POST ${BASE} \\
  -H "Content-Type: application/json" \\
  -d '{"text":"sabaidee","direction":"karaoke-to-lao"}'`}
          />
          <Block
            title="JavaScript"
            code={`const res = await fetch("${BASE}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "ສະບາຍດີ", direction: "lao-to-karaoke" }),
});
const { result } = await res.json();`}
          />
          <Block
            title="ຜົນລັບ"
            code={`{
  "ok": true,
  "direction": "lao-to-karaoke",
  "input": "ສະບາຍດີ",
  "result": "sa bai dee"
}`}
          />

          <h2 className="font-extrabold mb-2">ຂໍ້ຜິດພາດ</h2>
          <p className="text-sm text-muted-foreground">
            <code>400</code> — <code>invalid_input</code> ຫຼື <code>invalid_json</code>{" "}
            (ຂໍ້ຄວາມຫວ່າງເປົ່າ ຫຼື ຍາວເກີນ 5,000 ຕົວອັກສອນ)
          </p>
        </div>
      </main>
    </div>
  );
}
