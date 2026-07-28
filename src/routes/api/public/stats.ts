import { createFileRoute } from "@tanstack/react-router";

import {
  createTrustedRpcClient,
  clientKeyFromRequest,
  PUBLIC_API_DAILY_LIMIT,
} from "@/lib/public-api";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export const Route = createFileRoute("/api/public/stats")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const days = clampInt(url.searchParams.get("days"), 14, 1, 90);
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);

        const client = await createTrustedRpcClient();
        if (!client) return json({ ok: false, error: "unavailable" }, 503);

        const [top, series, quota] = await Promise.all([
          client.rpc("public_top_words", { p_days: days, p_limit: limit }),
          client.rpc("public_word_usage_series", { p_days: days }),
          clientKeyFromRequest(request).then((key) =>
            client.rpc("api_quota_status", { p_key: key, p_limit: PUBLIC_API_DAILY_LIMIT }),
          ),
        ]);

        if (top.error || series.error) {
          return json({ ok: false, error: "query_failed" }, 500);
        }

        return json({
          ok: true,
          days,
          top_words: (top.data ?? []).map((r) => ({
            word: r.word,
            direction: r.direction,
            uses: Number(r.uses),
          })),
          series: (series.data ?? []).map((r) => ({ day: r.day, uses: Number(r.uses) })),
          quota: quota.data ?? null,
        });
      },
    },
  },
});
