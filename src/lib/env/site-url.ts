import "server-only";

import { resolveSiteUrl } from "./site-url-rules";

export class SiteUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteUrlConfigError";
  }
}

/**
 * The app's public base URL for links sent to people (invites, auth emails)
 * and page metadata. Throws a clear configuration error instead of silently
 * falling back to localhost outside development.
 */
export function getSiteUrl(): string {
  const result = resolveSiteUrl({
    // Literal reads so Next.js inlines the public value at build time.
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    requirePublic: process.env.REQUIRE_PUBLIC_SITE_URL,
  });
  if (!result.ok) throw new SiteUrlConfigError(result.error);
  return result.url;
}
