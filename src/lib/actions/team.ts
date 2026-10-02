"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ACTIVE_WORKSPACE_COOKIE, ACTIVE_WORKSPACE_COOKIE_OPTIONS, PENDING_INVITE_COOKIE } from "@/lib/cookies";
import { dbErrorMessage } from "@/lib/db-errors";
import { publicEnv } from "@/lib/env/public";
import { canInvite, canLeave, canManageMember, grantableRoles } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  changeRoleSchema,
  invitationIdSchema,
  invitationTokenSchema,
  inviteMemberSchema,
  memberIdSchema,
} from "@/lib/validation/team";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates an invitation and returns the one-time invite link. */
export async function createInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canInvite(active.role)) {
    return { status: "error", message: "Only owners and admins can invite people.", values };
  }

  const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const { email, role } = parsed.data;
  if (!grantableRoles(active.role).includes(role)) {
    return { status: "error", fieldErrors: { role: ["Only the owner can invite admins"] }, values };
  }

  const supabase = await createClient();

  // Already a member? (Co-member profiles are readable under RLS.)
  const { data: members, error: membersError } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", active.id);
  if (membersError) return { status: "error", message: "Could not check existing members. Please try again.", values };
  if (members.length) {
    const { data: existing } = await supabase
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
    if (existing?.length) {
      return { status: "error", fieldErrors: { email: ["This person is already a member"] }, values };
    }
  }

  // Clear an expired invite for the same address so a fresh one can be sent.
  await supabase
    .from("workspace_invitations")
    .delete()
    .eq("workspace_id", active.id)
    .eq("email", email)
    .is("accepted_at", null)
    .lt("expires_at", new Date().toISOString());

  const token = randomBytes(32).toString("base64url");
  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: active.id,
    email,
    role,
    token_hash: hashToken(token),
    invited_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { email: ["There is already a pending invitation for this email. Revoke it to send a new one."] },
        values,
      };
    }
    return {
      status: "error",
      message: dbErrorMessage(error, "Could not create the invitation. Please try again."),
      values,
    };
  }

  revalidatePath("/app/team");
  return {
    status: "success",
    message: `Invitation created for ${email}.`,
    data: { inviteUrl: `${publicEnv.siteUrl}/invite/${token}`, email },
  };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canInvite(active.role)) return { ok: false, error: "Only owners and admins can revoke invitations." };
  const parsed = invitationIdSchema.safeParse({ invitationId });
  if (!parsed.success) return { ok: false, error: "Invalid invitation." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .delete()
    .eq("id", parsed.data.invitationId)
    .eq("workspace_id", active.id)
    .is("accepted_at", null)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not revoke the invitation.") };
  if (!data.length) return { ok: false, error: "That invitation no longer exists." };

  revalidatePath("/app/team");
  return { ok: true, message: "Invitation revoked." };
}

async function loadTarget(workspaceId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return { supabase, target: data };
}

export async function changeMemberRole(userId: string, role: string): Promise<ActionResult> {
  const { user, active } = await getWorkspaceContext();
  const parsed = changeRoleSchema.safeParse({ userId, role });
  if (!parsed.success) return { ok: false, error: "Invalid role." };

  const { supabase, target } = await loadTarget(active.id, parsed.data.userId);
  if (!target || target.role === "client") return { ok: false, error: "That member no longer exists." };
  if (!canManageMember({ userId: user.id, role: active.role }, { userId: target.user_id, role: target.role })) {
    return { ok: false, error: "You don't have permission to change this member's role." };
  }
  if (!grantableRoles(active.role).includes(parsed.data.role)) {
    return { ok: false, error: "Only the owner can grant the admin role." };
  }
  if (target.role === parsed.data.role) return { ok: true };

  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", active.id)
    .eq("user_id", target.user_id)
    .select("user_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not change the role.") };
  if (!data.length) return { ok: false, error: "You don't have permission to change this member's role." };

  revalidatePath("/app/team");
  return { ok: true, message: "Role updated." };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const { user, active } = await getWorkspaceContext();
  const parsed = memberIdSchema.safeParse({ userId });
  if (!parsed.success) return { ok: false, error: "Invalid member." };

  const { supabase, target } = await loadTarget(active.id, parsed.data.userId);
  if (!target) return { ok: false, error: "That member no longer exists." };
  if (!canManageMember({ userId: user.id, role: active.role }, { userId: target.user_id, role: target.role })) {
    return { ok: false, error: "You don't have permission to remove this member." };
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", active.id)
    .eq("user_id", target.user_id)
    .select("user_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not remove the member.") };
  if (!data.length) return { ok: false, error: "You don't have permission to remove this member." };

  revalidatePath("/app/team");
  return { ok: true, message: "Member removed." };
}

export async function leaveWorkspace(): Promise<ActionResult> {
  const { user, active } = await getWorkspaceContext();
  if (!canLeave(active.role)) {
    return { ok: false, error: "The owner can't leave the workspace." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", active.id)
    .eq("user_id", user.id)
    .select("user_id");
  if (error || !data.length) return { ok: false, error: dbErrorMessage(error, "Could not leave the workspace.") };

  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  revalidatePath("/app", "layout");
  redirect("/app");
}

/** Accept an invitation as the signed-in user (from /invite/[token]). */
export async function acceptInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = formData.get("token");
  await requireUser(typeof token === "string" ? `/invite/${token}` : "/app");
  const parsed = invitationTokenSchema.safeParse(token);
  if (!parsed.success) return { status: "error", message: "This invitation link is invalid." };

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data });
  if (error || !workspaceId) {
    return { status: "error", message: dbErrorMessage(error, "Could not accept the invitation. Please try again.") };
  }

  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, ACTIVE_WORKSPACE_COOKIE_OPTIONS);
  store.delete(PENDING_INVITE_COOKIE);
  revalidatePath("/app", "layout");
  redirect("/app?joined=1");
}
