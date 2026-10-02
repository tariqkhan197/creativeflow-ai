import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/cookies";
import type { Profile, Workspace, WorkspaceRole } from "@/types/database";

export { ACTIVE_WORKSPACE_COOKIE };

export type WorkspaceWithRole = Workspace & { role: WorkspaceRole; client_id: string | null };

export type WorkspaceContext = {
  user: SessionUser;
  profile: Profile | null;
  workspaces: WorkspaceWithRole[];
  active: WorkspaceWithRole;
};

/** All workspaces the signed-in user belongs to (RLS-scoped). */
export const getUserWorkspaces = cache(async (userId: string): Promise<WorkspaceWithRole[]> => {
  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, client_id")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not load workspaces: ${error.message}`);
  if (!memberships?.length) return [];

  const { data: workspaces, error: wsError } = await supabase
    .from("workspaces")
    .select("*")
    .in(
      "id",
      memberships.map((m) => m.workspace_id),
    )
    .order("name");
  if (wsError) throw new Error(`Could not load workspaces: ${wsError.message}`);

  return (workspaces ?? []).map((ws) => {
    const m = memberships.find((x) => x.workspace_id === ws.id)!;
    return { ...ws, role: m.role, client_id: m.client_id };
  });
});

export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
});

/**
 * Resolves the active workspace from the cookie, falling back to the first
 * membership. The cookie is only a preference — membership is always
 * re-checked against the database. Redirects to onboarding when the user has
 * no workspace yet.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser("/app");
  const [workspaces, profile] = await Promise.all([getUserWorkspaces(user.id), getProfile(user.id)]);
  if (workspaces.length === 0) redirect("/onboarding");

  const preferred = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
  return { user, profile, workspaces, active };
});

export const STAFF_ROLES: WorkspaceRole[] = ["owner", "admin", "manager", "member"];
export const MANAGER_ROLES: WorkspaceRole[] = ["owner", "admin", "manager"];
export const ADMIN_ROLES: WorkspaceRole[] = ["owner", "admin"];

export function hasRole(role: WorkspaceRole, allowed: WorkspaceRole[]) {
  return allowed.includes(role);
}

export { ROLE_LABELS } from "@/lib/roles";
