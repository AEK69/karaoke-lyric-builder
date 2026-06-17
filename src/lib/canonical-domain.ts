// Single source of truth for the primary domain. Firebase serves this app on
// karaoke-aek.web.app / karaoke-aek.firebaseapp.com as well, but we treat
// karaoke-aek.online as canonical so OAuth always returns there and visitors on
// the Firebase default domains get forwarded to it.
export const CANONICAL_ORIGIN = "https://karaoke-aek.online";

// Local dev runs on localhost; never force the canonical domain there or the
// OAuth round-trip would bounce off the deployed site instead of the dev server.
function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
}

/**
 * Origin to hand to Supabase as `redirect_to`. Returns the live origin during
 * local development, the canonical domain everywhere else (including SSR).
 */
export function canonicalOrigin(): string {
  if (typeof window === "undefined") return CANONICAL_ORIGIN;
  if (isLocalHost(window.location.hostname)) return window.location.origin;
  return CANONICAL_ORIGIN;
}

/**
 * Forward the browser to the canonical domain when it lands on a non-canonical
 * production host (e.g. *.web.app, *.firebaseapp.com), preserving the path,
 * query and hash. No-op on localhost and when already on the canonical domain.
 */
export function redirectToCanonical(): void {
  if (typeof window === "undefined") return;
  const { hostname, origin, pathname, search, hash } = window.location;
  if (isLocalHost(hostname)) return;
  if (origin === CANONICAL_ORIGIN) return;
  window.location.replace(`${CANONICAL_ORIGIN}${pathname}${search}${hash}`);
}
