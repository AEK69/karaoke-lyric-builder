export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "kb:theme";

// Mobile status-bar tint per resolved mode (kept in sync with the manifest).
const THEME_COLORS = { light: "#d6318a", dark: "#0b0b12" } as const;

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const dark = resolveTheme(theme) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const t = localStorage.getItem(THEME_KEY);
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

// Runs synchronously in <head> before hydration so the page paints in the right
// mode immediately — no light/dark flash. Mirrors the logic in resolveTheme.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
