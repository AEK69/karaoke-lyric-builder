import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { translate, setCommunityWords, type Direction } from "@/lib/translator";
import type { Database } from "@/integrations/supabase/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  direction: z.enum(["lao-to-karaoke", "karaoke-to-lao"]).default("lao-to-karaoke"),
});

let wordsLoadedAt = 0;

async function loadCommunityWords() {
  // Refresh the approved community dictionary at most once a minute per worker.
  if (Date.now() - wordsLoadedAt < 60_000) return;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  const client = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data } = await client
    .from("word_suggestions")
    .select("lao_word, karaoke_word")
    .eq("status", "approved")
    .limit(5000);
  if (data) {
    setCommunityWords(data.map((r) => ({ lao: r.lao_word, karaoke: r.karaoke_word })));
    wordsLoadedAt = Date.now();
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function handle(text: unknown, direction: unknown) {
  const parsed = bodySchema.safeParse({ text, direction: direction ?? "lao-to-karaoke" });
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_input", detail: parsed.error.issues[0]?.message }, 400);
  }
  await loadCommunityWords();
  const result = translate(parsed.data.text, parsed.data.direction as Direction);
  return json({
    ok: true,
    direction: parsed.data.direction,
    input: parsed.data.text,
    result,
  });
}

export const Route = createFileRoute("/api/public/translate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return handle(url.searchParams.get("text") ?? "", url.searchParams.get("direction") ?? undefined);
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const b = (body ?? {}) as Record<string, unknown>;
        return handle(b.text, b.direction);
      },
    },
  },
});
