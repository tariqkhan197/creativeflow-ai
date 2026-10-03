import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { resolveSiteUrl, siteUrlEnvFrom } from "./src/lib/env/site-url-rules";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

export default function config(phase: string): NextConfig {
  // Fail a production build/start clearly when NEXT_PUBLIC_SITE_URL is missing,
  // or local on a deployment, instead of shipping links to localhost.
  // `next typegen` (npm run typecheck) also loads this config in the build phase;
  // it generates types only, so it doesn't need the URL.
  const typegenOnly = process.argv.includes("typegen");
  if ((phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER) && !typegenOnly) {
    const site = resolveSiteUrl(siteUrlEnvFrom(process.env));
    if (!site.ok) throw new Error(`Configuration error: ${site.error}`);
  }

  return {
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: SECURITY_HEADERS }];
    },
  };
}
