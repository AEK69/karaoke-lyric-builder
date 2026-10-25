const JVIX = "https://jvix.xyz";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "unavailable" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "login" });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid" });
  }

  const headers = {
    apikey: anon,
    Authorization: auth,
    "content-type": "application/json",
  };

  if (body.action === "generate") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/oneplay_create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_plan_label: body.plan }),
    });
    if (!res.ok) return json({ ok: false, error: "unavailable" });
    return json(await res.json());
  }

  if (body.action === "check") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/oneplay_poll`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_transaction_id: body.transactionId }),
    });
    if (!res.ok) return json({ ok: false, error: "unavailable" });
    return json(await res.json());
  }

  void JVIX;
  return json({ ok: false, error: "invalid" });
});
