import type { WorkspaceRole } from "@/types/database";
import type { StaffInviteRole } from "@/lib/validation/team";

/**
 * UI/server-action permission rules. They mirror the database rules (RLS and
 * triggers), which remain the final authority — these exist to give clear
 * errors and to hide actions a user can't perform.
 */

const STAFF: WorkspaceRole[] = ["owner", "admin", "manager", "member"];
const MANAGERS: WorkspaceRole[] = ["owner", "admin", "manager"];
const ADMINS: WorkspaceRole[] = ["owner", "admin"];

export const isStaff = (role: WorkspaceRole) => STAFF.includes(role);
export const canManageWork = (role: WorkspaceRole) => MANAGERS.includes(role); // clients, projects (create/delete)
export const canInvite = (role: WorkspaceRole) => ADMINS.includes(role);
/** Client portal access (client-role invitations and members) — managers and above. */
export const canManagePortalAccess = (role: WorkspaceRole) => MANAGERS.includes(role);

/** Roles an actor may grant via invitation or role change. */
export function grantableRoles(actor: WorkspaceRole): StaffInviteRole[] {
  if (actor === "owner") return ["admin", "manager", "member"];
  if (actor === "admin") return ["manager", "member"];
  return [];
}

type Member = { userId: string; role: WorkspaceRole };

/** Whether `actor` may change the role of, or remove, `target`. */
export function canManageMember(actor: Member, target: Member): boolean {
  if (target.role === "owner") return false;
  if (actor.userId === target.userId) return false; // use "leave" instead
  if (actor.role === "owner") return true;
  if (actor.role === "admin") return target.role !== "admin";
  return false;
}

/** Whether a user may leave the workspace (the owner must transfer ownership first). */
export const canLeave = (role: WorkspaceRole) => role !== "owner";
