/** Routes that require a signed-in user. */
export const PROTECTED_PREFIXES = ["/app", "/onboarding"];

/** Auth pages a signed-in user is redirected away from. */
export const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"];

/**
 * Only allow redirects to same-origin relative paths, to prevent open
 * redirects through `?next=`.
 */
export function safeRedirectPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
