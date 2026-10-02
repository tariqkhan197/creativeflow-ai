"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/db-errors";
import { publicEnv } from "@/lib/env/public";
import { canManagePortalAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { clearExpiredInvitation, isWorkspaceMemberEmail } from "@/lib/team/members";
import { clientInvitationSchema, clientUserSchema, inviteClientUserSchema } from "@/lib/validation/portal";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const NOT_ALLOWED = "Only owners, admins and managers can manage client portal access.";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Invites a client contact to the portal. They are bound to this client and
 * only ever see its portal-visible projects. Returns the one-time link.
 */
export async function createClientInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canManagePortalAccess(active.role)) return { status: "error", message: NOT_ALLOWED, values };

  const parsed = inviteClientUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const { clientId, email } = parsed.data;

  const supabase = await createClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (clientError) return { status: "error", message: "Could not load the client. Please try again.", values };
  if (!client) return { status: "error", message: "This client no longer exists.", values };

  const alreadyMember = await isWorkspaceMemberEmail(supabase, active.id, email);
  if (alreadyMember === null) {
    return { status: "error", message: "Could not check existing members. Please try again.", values };
  }
  if (alreadyMember) {
    return {
      status: "error",
      fieldErrors: { email: ["This person already has access to this workspace"] },
      values,
    };
  }
  await clearExpiredInvitation(supabase, active.id, email);

  const token = randomBytes(32).toString("base64url");
  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: active.id,
    email,
    role: "client",
    client_id: client.id,
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

  revalidatePath(`/app/clients/${client.id}`);
  return {
    status: "success",
    message: `Portal invitation created for ${email}.`,
    data: { inviteUrl: `${publicEnv.siteUrl}/invite/${token}`, email },
  };
}

export async function revokeClientInvitation(clientId: string, invitationId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManagePortalAccess(active.role)) return { ok: false, error: NOT_ALLOWED };
  const parsed = clientInvitationSchema.safeParse({ clientId, invitationId });
  if (!parsed.success) return { ok: false, error: "Invalid invitation." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .delete()
    .eq("id", parsed.data.invitationId)
    .eq("client_id", parsed.data.clientId)
    .eq("workspace_id", active.id)
    .eq("role", "client")
    .is("accepted_at", null)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not revoke the invitation.") };
  if (!data.length) return { ok: false, error: "That invitation no longer exists." };

  revalidatePath(`/app/clients/${parsed.data.clientId}`);
  return { ok: true, message: "Invitation revoked." };
}

/** Removes a client user's portal access. Their comments and decisions stay on record. */
export async function removeClientUser(clientId: string, userId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManagePortalAccess(active.role)) return { ok: false, error: NOT_ALLOWED };
  const parsed = clientUserSchema.safeParse({ clientId, userId });
  if (!parsed.success) return { ok: false, error: "Invalid portal user." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", active.id)
    .eq("user_id", parsed.data.userId)
    .eq("client_id", parsed.data.clientId)
    .eq("role", "client")
    .select("user_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not remove portal access.") };
  if (!data.length) return { ok: false, error: "That person no longer has portal access." };

  revalidatePath(`/app/clients/${parsed.data.clientId}`);
  return { ok: true, message: "Portal access removed." };
}
