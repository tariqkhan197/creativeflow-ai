/** Routes that require a signed-in user. */
export const PROTECTED_PREFIXES = ["/app", "/portal", "/onboarding"];

/** Auth pages a signed-in user is redirected away from. */
export const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"];

// Placeholder origin for resolving a candidate path; never used as a destination.
const PROBE_ORIGIN = "https://same-origin.invalid";
/**
 * Backslashes (some browsers treat them as "/") and ASCII control characters,
 * including tab and newline, which URL parsers silently strip: "/\t/evil.com"
 * would otherwise resolve to "//evil.com", another site.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Only allow redirects to same-origin relative paths, to prevent open
 * redirects through `?next=`. Returns the normalised path (with query and
 * hash) or `fallback`.
 */
export function safeRedirectPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || hasUnsafeCharacter(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
