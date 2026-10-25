/**
 * Client-side security protections:
 * - Disables context menu (right-click)
 * - Blocks DevTools keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U)
 * - Silences console logs in production to prevent probing backend internals
 */

export function initClientSecurity() {
  if (typeof window === "undefined") return;

  // 1. Disable context menu (right click)
  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      return false;
    },
    true,
  );

  // 2. Block inspection keyboard shortcuts across Windows, Linux and Mac
  window.addEventListener(
    "keydown",
    (e) => {
      // F12
      if (e.key === "F12" || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl+Shift+I / Cmd+Opt+I (DevTools)
      // Ctrl+Shift+J / Cmd+Opt+J (Console)
      // Ctrl+Shift+C / Cmd+Opt+C (Inspect)
      if (
        (ctrlOrMeta && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        (e.metaKey && e.altKey && ["i", "j", "c"].includes(key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl+U / Cmd+Opt+U (View Page Source)
      if ((ctrlOrMeta && key === "u") || (e.metaKey && e.altKey && key === "u")) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl+S / Cmd+S (Save Page)
      if (ctrlOrMeta && key === "s") {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    },
    true,
  );

  // 3. Silence console in production to prevent leaking Supabase payloads or endpoint data
  if (import.meta.env.PROD) {
    try {
      const noop = () => {};
      window.console.log = noop;
      window.console.info = noop;
      window.console.debug = noop;
      window.console.warn = noop;
      window.console.clear();
    } catch {
      // Ignore
    }
  }
}
