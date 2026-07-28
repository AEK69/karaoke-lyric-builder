import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

import { applyTheme, getStoredTheme, THEME_KEY, type Theme } from "@/lib/theme";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Default matches the server render ("system"); the real stored value is read
  // after mount to avoid a hydration mismatch. The inline head script has
  // already applied the correct class, so there's no visual flash either way.
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window === "undefined") return;
    // Follow live OS changes while on "system".
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    if (typeof window !== "undefined") localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

const ORDER: Theme[] = ["light", "dark", "system"];
const ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const LABEL: Record<Theme, string> = {
  light: "ສະຫວ່າງ",
  dark: "ມືດ",
  system: "ຕາມລະບົບ",
};

// Cycles light → dark → system, showing the current mode's icon.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      onClick={() => setTheme(next)}
      title={`ຮູບແບບສີ: ${LABEL[theme]} (ກົດເພື່ອປ່ຽນ)`}
      aria-label={`Theme: ${theme}`}
      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-muted hover:bg-muted/70 flex items-center justify-center transition shrink-0"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
