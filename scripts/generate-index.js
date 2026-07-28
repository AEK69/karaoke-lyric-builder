import { execSync, spawn } from "child_process";
import { writeFileSync, readdirSync } from "fs";

const PORT = 3099;
const url = `http://localhost:${PORT}/`;

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

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  let html = await res.text();

  // The SSR server and the client build can compute different content hashes
  // for the same CSS, so the rendered <link href="/assets/styles-*.css"> may
  // point to a file that doesn't exist in .output/public. Rewrite every CSS
  // href to the real stylesheet present in the client assets directory.
  const realCss = readdirSync(".output/public/assets").filter((f) => f.endsWith(".css"));
  if (realCss.length === 1) {
    html = html.replace(/\/assets\/[A-Za-z0-9._-]+\.css/g, `/assets/${realCss[0]}`);
  } else if (realCss.length > 1) {
    console.warn(`Multiple CSS files found, skipping rewrite: ${realCss.join(", ")}`);
  }

  writeFileSync(".output/public/index.html", html);
  console.log(
    `Generated .output/public/index.html from SSR (${html.length} bytes), CSS -> ${realCss.join(", ")}`,
  );
} catch (e) {
  console.error("SSR pre-render failed:", e.message);
  process.exit(1);
} finally {
  server.kill();
}
