import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { translate, setCommunityWords, extractKnownWords, type Direction } from "@/lib/translator";
import {
  createPublicClient,
  createTrustedRpcClient,
  clientKeyFromRequest,
  PUBLIC_API_DAILY_LIMIT,
} from "@/lib/public-api";

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
  const client = createPublicClient();
  if (!client) return;
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

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extraHeaders },
  });
}

interface Quota { allowed: boolean; limit: number; used: number; remaining: number }

async function handle(request: Request, text: unknown, direction: unknown) {
  const parsed = bodySchema.safeParse({ text, direction: direction ?? "lao-to-karaoke" });
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_input", detail: parsed.error.issues[0]?.message }, 400);
  }

  const client = createPublicClient();
  const rpc = await createTrustedRpcClient();
  let quota: Quota = { allowed: true, limit: PUBLIC_API_DAILY_LIMIT, used: 0, remaining: PUBLIC_API_DAILY_LIMIT };

  if (rpc) {
    const key = await clientKeyFromRequest(request);
    const { data } = await rpc.rpc("api_consume", { p_key: key, p_limit: PUBLIC_API_DAILY_LIMIT });
    if (data) quota = data as unknown as Quota;
  }

  const quotaHeaders = {
    "X-RateLimit-Limit": String(quota.limit),
    "X-RateLimit-Remaining": String(quota.remaining),
  };

  if (!quota.allowed) {
    return json(
      { ok: false, error: "quota_exceeded", quota: { limit: quota.limit, used: quota.used, remaining: 0 } },
      429,
      quotaHeaders,
    );
  }

  await loadCommunityWords();
  const dir = parsed.data.direction as Direction;
  const result = translate(parsed.data.text, dir);

  // Fire-and-forget usage stats for the popular-words endpoint.
  if (rpc) {
    const words = extractKnownWords(parsed.data.text, dir);
    if (words.length) void rpc.rpc("record_word_usage", { p_words: words, p_direction: dir });
  }


  return json(
    {
      ok: true,
      direction: parsed.data.direction,
      input: parsed.data.text,
      result,
      quota: { limit: quota.limit, used: quota.used, remaining: quota.remaining },
    },
    200,
    quotaHeaders,
  );
}

export const Route = createFileRoute("/api/public/translate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return handle(request, url.searchParams.get("text") ?? "", url.searchParams.get("direction") ?? undefined);
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const b = (body ?? {}) as Record<string, unknown>;
        return handle(request, b.text, b.direction);
      },
    },
  },
});
