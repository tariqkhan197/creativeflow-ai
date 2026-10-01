/**
 * Public (browser-safe) configuration.
 *
 * Each variable must be read with a literal `process.env.NEXT_PUBLIC_*`
 * expression so Next.js can inline it into client bundles.
 */

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabasePublishableKey =
  clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
  // Legacy name, still supported by Supabase.
  clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function isValidUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const publicEnv = {
  siteUrl: clean(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000",
  supabaseUrl,
  supabasePublishableKey,
} as const;

/** True when the browser/server can talk to Supabase. */
export const isSupabaseConfigured = isValidUrl(supabaseUrl) && Boolean(supabasePublishableKey);

export function getSupabasePublicConfig(): { url: string; key: string } {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new SupabaseNotConfiguredError();
  }
  return { url: supabaseUrl, key: supabasePublishableKey };
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see docs/SETUP.md).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
