"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getSupabasePublicConfig } from "@/lib/env/public";

/** Supabase client for Client Components. Uses only the publishable key. */
export function createClient() {
  const { url, key } = getSupabasePublicConfig();
  return createBrowserClient<Database>(url, key);
}
