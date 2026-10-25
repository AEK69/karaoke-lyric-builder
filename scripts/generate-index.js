import { spawn } from "child_process";
import { writeFileSync, readdirSync, mkdirSync } from "fs";
import { dirname } from "path";

const PORT = 3099;
const env = {
  ...process.env,
  PORT: String(PORT),
  SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
  SUPABASE_PUBLISHABLE_KEY:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
};

const server = spawn("node", [".output/server/index.mjs"], { env, stdio: "pipe" });

let started = false;
server.stdout.on("data", (d) => {
  if (d.toString().includes("Listening")) started = true;
});
server.stderr.on("data", () => {});

await new Promise((res) => setTimeout(res, 3000));

const ROUTES = [
  { path: "/", out: ".output/public/index.html" },
  { path: "/payment", out: ".output/public/payment/index.html" },
  { path: "/payment", out: ".output/public/payment.html" },
  { path: "/redeem", out: ".output/public/redeem/index.html" },
  { path: "/api-docs", out: ".output/public/api-docs/index.html" },
];

try {
  const realCss = readdirSync(".output/public/assets").filter((f) => f.endsWith(".css"));

  for (const r of ROUTES) {
    try {
      const res = await fetch(`http://localhost:${PORT}${r.path}`);
      if (!res.ok) {
        console.warn(`Route ${r.path} returned ${res.status}, skipping.`);
        continue;
      }
      let html = await res.text();

      // Ensure CSS points to the actual file in assets
      if (realCss.length === 1) {
        html = html.replace(/\/assets\/[A-Za-z0-9._-]+\.css/g, `/assets/${realCss[0]}`);
      }

      mkdirSync(dirname(r.out), { recursive: true });
      writeFileSync(r.out, html);
      console.log(`Generated ${r.out} from SSR for ${r.path} (${html.length} bytes)`);
    } catch (routeErr) {
      console.warn(`Failed to render ${r.path}:`, routeErr.message);
    }
  }
} catch (e) {
  console.error("SSR pre-render failed:", e.message);
  process.exit(1);
} finally {
  server.kill();
}
