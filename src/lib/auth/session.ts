import "server-only";

import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string;
};

/**
 * The signed-in user for this request, verified from the JWT (getClaims
 * validates the signature), or null. Memoised per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Always render per request, even when Supabase isn't configured at build time.
  await connection();
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : "" };
});

/** Like getSessionUser, but redirects to /login when signed out. */
export async function requireUser(next?: string): Promise<SessionUser> {
  await connection();
  if (!isSupabaseConfigured) redirect("/setup");
  const user = await getSessionUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
