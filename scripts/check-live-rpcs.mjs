#!/usr/bin/env node
// Guard against the recurring "migration not applied to live DB" bug.
//
// Every function/table below is something the app calls at runtime. We probe
// the live PostgREST endpoint with the anon key: a 404 PGRST202 means the
// object is MISSING from the database (a migration was never applied), which
// is exactly how the admin page silently broke. Anything else (401 permission
// denied, 400 bad args, 200) means the object EXISTS — that's a pass.
//
// Usage:  node scripts/check-live-rpcs.mjs
// Env:    reads SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, or VITE_* equivalents,
//         falling back to values in .env.production.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(name) {
  try {
    const out = {};
    for (const line of readFileSync(join(root, name), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = loadEnvFile(".env.production");
const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  fileEnv.VITE_SUPABASE_URL ||
  fileEnv.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.SUPABASE_PUBLISHABLE_KEY;

if (!URL || !KEY) {
  console.error("✗ Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (env or .env.production)");
  process.exit(2);
}

// RPCs the app invokes, each with the CORRECT parameter names. PostgREST
// resolves an overload by the argument names supplied, so a wrong/empty arg set
// yields a false 404. We use the real param names (dummy values are fine) — the
// anon key is still permission-gated, so nothing actually executes.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const RPCS = {
  admin_stats: { p_days: 14 },
  admin_search_users: { p_query: "" },
  admin_list_topup_codes: { p_filter: "all" },
  admin_list_payments: { p_status: "pending" },
  admin_list_suggestions: { p_status: "pending" },
  admin_review_suggestion: { p_id: NIL_UUID, p_approve: true },
  admin_list_audit_logs: { p_limit: 10 },
  admin_grant_premium: { p_user: NIL_UUID, p_days: 1 },
  admin_revoke_premium: { p_user: NIL_UUID },
  admin_add_credits: { p_user: NIL_UUID, p_amount: 1 },
  admin_reset_credits: { p_user: NIL_UUID },
  admin_approve_payment: { p_id: NIL_UUID },
  admin_reject_payment: { p_id: NIL_UUID },
  admin_create_topup_code: { p_credits: 1, p_premium_days: 0, p_max_uses: 1 },
  admin_delete_topup_code: { p_id: NIL_UUID },
  submit_word_suggestion: { p_lao: "x", p_karaoke: "x" },
  redeem_topup_code: { p_code: "x" },
  public_top_words: { p_days: 14, p_limit: 10 },
  public_word_usage_series: { p_days: 14 },
  record_word_usage: { p_words: ["x"] },
  api_consume: { p_key: "x" },
  api_quota_status: { p_key: "x" },
  mark_notifications_read: {},
  is_valid_payment_plan: { p_plan_label: "x", p_amount: 1, p_credits: 1, p_premium_days: 1 },
};

// Tables the app reads via PostgREST.
const TABLES = ["profiles", "word_suggestions", "topup_codes", "payment_requests"];

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const missing = [];
const errors = [];

async function probeRpc(fn, args) {
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => ({}));
    // PGRST202 = "function not found in schema cache" => genuinely missing.
    if (res.status === 404 && body.code === "PGRST202") missing.push(`rpc  ${fn}`);
  } catch (e) {
    errors.push(`rpc  ${fn}: ${e.message}`);
  }
}

async function probeTable(t) {
  try {
    const res = await fetch(`${URL}/rest/v1/${t}?select=*&limit=0`, { headers });
    const body = await res.json().catch(() => ({}));
    // PGRST205 = "table not found in schema cache".
    if (res.status === 404 && body.code === "PGRST205") missing.push(`table ${t}`);
  } catch (e) {
    errors.push(`table ${t}: ${e.message}`);
  }
}

const rpcNames = Object.keys(RPCS);
console.log(`Probing ${URL} — ${rpcNames.length} RPCs, ${TABLES.length} tables…`);
await Promise.all([...rpcNames.map((fn) => probeRpc(fn, RPCS[fn])), ...TABLES.map(probeTable)]);

if (errors.length) {
  console.error("\n⚠ Network/probe errors (could not verify):");
  for (const e of errors) console.error("  " + e);
}

if (missing.length) {
  console.error(`\n✗ ${missing.length} object(s) MISSING from live DB (unapplied migration?):`);
  for (const m of missing) console.error("  " + m);
  console.error(
    "\n→ Apply pending SQL in the Supabase SQL Editor (see supabase/APPLY_PENDING_ADMIN.sql).",
  );
  process.exit(1);
}

if (errors.length) process.exit(2);
console.log(`\n✓ All ${rpcNames.length} RPCs and ${TABLES.length} tables exist on live DB.`);
