/**
 * HTTP security headers sent with every response (wired up in next.config.ts).
 *
 * Kept deliberately minimal so nothing in the app breaks: no script/style
 * Content-Security-Policy yet, only the frame-ancestors directive.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Nobody may frame the app (clickjacking, e.g. on Approve / Request changes).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Don't let browsers guess content types.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send only the origin to other sites; invite tokens in paths never leak via Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Powerful features the app doesn't use. Fullscreen (video player) and clipboard (copy invite link) stay allowed.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // HTTPS only for two years (ignored by browsers over plain http, e.g. localhost).
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];
