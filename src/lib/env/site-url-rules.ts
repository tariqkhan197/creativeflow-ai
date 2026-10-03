/**
 * Rules for the app's public base URL (NEXT_PUBLIC_SITE_URL), used in invite
 * links, auth email redirects and page metadata.
 *
 * Pure and dependency-free: it is used by server code (src/lib/env/site-url.ts)
 * and by next.config.ts, so a deployment with a missing or local URL fails at
 * build/start time instead of sending people links to localhost.
 */

export type SiteUrlEnv = {
  /** NEXT_PUBLIC_SITE_URL */
  siteUrl?: string;
  /** NODE_ENV */
  nodeEnv?: string;
  /** VERCEL_ENV: "production" | "preview" | "development" (set by Vercel) */
  vercelEnv?: string;
  /** VERCEL_URL: the deployment's own hostname (set by Vercel) */
  vercelUrl?: string;
  /** REQUIRE_PUBLIC_SITE_URL=true: treat this as a deployment on hosts other than Vercel */
  requirePublic?: string;
};

export type SiteUrlResult = { ok: true; url: string } | { ok: false; error: string };

export const LOCAL_DEV_SITE_URL = "http://localhost:3000";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.startsWith("127.");
}

export function resolveSiteUrl(env: SiteUrlEnv): SiteUrlResult {
  const value = env.siteUrl?.trim() || undefined;
  const production = env.nodeEnv === "production";
  const deployed =
    env.vercelEnv === "production" || env.vercelEnv === "preview" || env.requirePublic?.trim() === "true";

  if (!value) {
    if (!production) return { ok: true, url: LOCAL_DEV_SITE_URL };
    const previewHost = env.vercelUrl?.trim();
    if (env.vercelEnv === "preview" && previewHost) return { ok: true, url: `https://${previewHost}` };
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_SITE_URL is not set. Set it to the app's public URL (for example https://app.example.com) " +
        "so invite links and sign-in emails point to the right place. See docs/SETUP.md.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not a valid URL (expected e.g. https://app.example.com)." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "NEXT_PUBLIC_SITE_URL must start with https://." };
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_SITE_URL must be just the origin, without a path (for example https://app.example.com).",
    };
  }
  if (deployed) {
    if (isLocalHost(url.hostname)) {
      return {
        ok: false,
        error: `NEXT_PUBLIC_SITE_URL points to ${url.hostname}, which isn't reachable by your users. Set it to the deployment's public URL.`,
      };
    }
    if (url.protocol !== "https:") {
      return { ok: false, error: "NEXT_PUBLIC_SITE_URL must use https:// in a deployed environment." };
    }
  }
  return { ok: true, url: url.origin };
}

/** Reads the variables from a process environment. */
export function siteUrlEnvFrom(env: Record<string, string | undefined>): SiteUrlEnv {
  return {
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    nodeEnv: env.NODE_ENV,
    vercelEnv: env.VERCEL_ENV,
    vercelUrl: env.VERCEL_URL,
    requirePublic: env.REQUIRE_PUBLIC_SITE_URL,
  };
}
