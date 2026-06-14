import { execSync, spawn } from "child_process";
import { writeFileSync } from "fs";

const PORT = 3099;
const url = `http://localhost:${PORT}/`;

const env = {
  ...process.env,
  PORT: String(PORT),
  SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
  SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
};

const server = spawn("node", [".output/server/index.mjs"], { env, stdio: "pipe" });

let started = false;
server.stdout.on("data", (d) => { if (d.toString().includes("Listening")) started = true; });
server.stderr.on("data", () => {});

await new Promise((res) => setTimeout(res, 3000));

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const html = await res.text();
  writeFileSync("dist/client/index.html", html);
  console.log(`Generated dist/client/index.html from SSR (${html.length} bytes)`);
} catch (e) {
  console.error("SSR pre-render failed:", e.message);
  process.exit(1);
} finally {
  server.kill();
}
