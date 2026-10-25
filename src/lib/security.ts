/**
 * Client-side security protections:
 * - Disables context menu (right-click)
 * - Blocks DevTools keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U)
 * - Silences console logs in production to prevent probing backend internals
 */

export function initClientSecurity() {
  if (typeof window === "undefined") return;

  // 1. Disable context menu (right click)
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    return false;
  });

  // 2. Block inspection keyboard shortcuts
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

      // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect)
      if (ctrlOrMeta && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl+U (View Page Source)
      if (ctrlOrMeta && ["u", "U"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl+S (Save Page)
      if (ctrlOrMeta && ["s", "S"].includes(e.key)) {
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
      // Keep clear functional to prevent terminal logs accumulating
      window.console.clear();
    } catch {
      // Ignore
    }
  }
}
