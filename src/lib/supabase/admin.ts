import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabasePublicConfig } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";

/**
 * Privileged Supabase client that BYPASSES Row Level Security.
 *
 * Only use it in trusted server code that has already authorised the request
 * by other means (e.g. a verified Stripe webhook signature). Never use it to
 * serve data for a user request.
 */
export function createAdminClient() {
  const { url } = getSupabasePublicConfig();
  if (!serverEnv.supabaseSecretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set (see docs/SETUP.md).");
  }
  return createClient<Database>(url, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
