import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Whether `email` already belongs to a member of the workspace (any role).
 * Co-member profiles are readable under RLS. Returns null when the check
 * itself failed, so callers can refuse rather than guess.
 */
export async function isWorkspaceMemberEmail(
  supabase: Supabase,
  workspaceId: string,
  email: string,
): Promise<boolean | null> {
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId);
  if (error) return null;
  if (!members.length) return false;
  const { data: existing, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .in(
      "id",
      members.map((m) => m.user_id),
    )
    .ilike(
      "email",
      email.replace(/[\\%_]/g, (c) => `\\${c}`),
    );
  if (profileError) return null;
  return existing.length > 0;
}

/** Clears an expired, unaccepted invite for the same address so a fresh one can be sent. */
export async function clearExpiredInvitation(supabase: Supabase, workspaceId: string, email: string) {
  await supabase
    .from("workspace_invitations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("accepted_at", null)
    .lt("expires_at", new Date().toISOString());
}
