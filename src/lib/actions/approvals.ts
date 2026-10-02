"use server";

import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/db-errors";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  approvalIdSchema,
  assetShareSchema,
  decideApprovalSchema,
  projectPortalSchema,
  requestApprovalSchema,
  revisionStatusSchema,
} from "@/lib/validation/approvals";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const NO_ACCESS = "You don't have access to this project.";

function revalidateApprovals(projectId: string, assetId?: string | null) {
  revalidatePath("/app/approvals");
  revalidatePath(`/app/projects/${projectId}`);
  if (assetId) revalidatePath(`/app/projects/${projectId}/assets/${assetId}`);
  revalidatePath("/portal", "layout");
}

/** Portal visibility, client-facing summary and download permission (owners, admins, managers). */
export async function updateProjectPortal(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canManageWork(active.role)) {
    return { status: "error", message: "Only owners, admins and managers can change client portal settings.", values };
  }
  const parsed = projectPortalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: project, error: loadError } = await supabase
    .from("projects")
    .select("id, client_id")
    .eq("id", d.projectId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (loadError) return { status: "error", message: "Could not load the project. Please try again.", values };
  if (!project) return { status: "error", message: "This project no longer exists.", values };
  if (d.clientVisible && !project.client_id) {
    return {
      status: "error",
      fieldErrors: { clientVisible: ["Choose a client for this project first (Edit → Client)"] },
      values,
    };
  }

  const { data, error } = await supabase
    .from("projects")
    .update({
      client_visible: d.clientVisible,
      client_summary: d.clientSummary ?? null,
      allow_client_downloads: d.allowClientDownloads,
    })
    .eq("id", d.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) {
    return { status: "error", message: dbErrorMessage(error, "Could not save the portal settings."), values };
  }
  if (!data.length) return { status: "error", message: "This project no longer exists.", values };

  revalidateApprovals(d.projectId);
  return { status: "success", message: "Client portal settings saved." };
}

/** Share or unshare one version with the client (any staff member). */
export async function setAssetShared(assetId: string, shared: boolean): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  const parsed = assetShareSchema.safeParse({ assetId, shared });
  if (!parsed.success) return { ok: false, error: "Invalid file." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .update({ shared_with_client: parsed.data.shared })
    .eq("id", parsed.data.assetId)
    .eq("workspace_id", active.id)
    .eq("status", "ready")
    .select("id, project_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not change sharing.") };
  if (!data.length) return { ok: false, error: "This file no longer exists or hasn't finished uploading." };

  revalidateApprovals(data[0].project_id, data[0].id);
  return { ok: true, message: parsed.data.shared ? "Shared with the client." : "No longer shared with the client." };
}

/** Shares the version (if needed) and asks the client to approve it, in one database transaction. */
export async function requestApproval(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!isStaff(active.role)) return { status: "error", message: NO_ACCESS, values };
  const parsed = requestApprovalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("id, project_id")
    .eq("id", d.assetId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (!asset) return { status: "error", message: "This file no longer exists.", values };

  const { error } = await supabase.rpc("request_approval", {
    p_asset: asset.id,
    p_title: d.title,
    p_message: d.message ?? null,
    p_due_date: d.dueDate ?? null,
  });
  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "This version already has a pending approval.", values };
    }
    return { status: "error", message: dbErrorMessage(error, "Could not request approval. Please try again."), values };
  }

  revalidateApprovals(asset.project_id, asset.id);
  return { status: "success", message: "Approval requested. The client has been notified." };
}

/** Withdraws a pending request (managers, or the staff member who asked). */
export async function cancelApproval(approvalId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  const parsed = approvalIdSchema.safeParse({ approvalId });
  if (!parsed.success) return { ok: false, error: "Invalid approval." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approvals")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.approvalId)
    .eq("workspace_id", active.id)
    .eq("status", "pending")
    .select("id, project_id, asset_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not cancel the request.") };
  if (!data.length) {
    return {
      ok: false,
      error: "This request was already decided or cancelled, or only a manager or the requester can cancel it.",
    };
  }

  revalidateApprovals(data[0].project_id, data[0].asset_id);
  return { ok: true, message: "Approval request cancelled." };
}

export async function setRevisionStatus(revisionId: string, status: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  const parsed = revisionStatusSchema.safeParse({ revisionId, status });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("revisions")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.revisionId)
    .eq("workspace_id", active.id)
    .select("id, project_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not update the revision round.") };
  if (!data.length) return { ok: false, error: "This revision round no longer exists." };

  revalidateApprovals(data[0].project_id);
  return { ok: true, message: "Revision round updated." };
}

/**
 * Approve or request changes. Client users decide for their own client's
 * visible versions; owners, admins and managers may record a decision on the
 * client's behalf. decide_approval() re-checks all of this in the database.
 */
export async function decideApproval(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (active.role !== "client" && !canManageWork(active.role)) {
    return { status: "error", message: "Only the client (or a manager) can decide on an approval.", values };
  }
  const parsed = decideApprovalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: approval } = await supabase
    .from("approvals")
    .select("id, project_id, asset_id")
    .eq("id", d.approvalId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (!approval) return { status: "error", message: "This approval request no longer exists.", values };

  const { error } = await supabase.rpc("decide_approval", {
    p_approval: approval.id,
    p_decision: d.decision,
    p_note: d.note ?? null,
  });
  if (error) {
    return {
      status: "error",
      message: dbErrorMessage(error, "Could not record your decision. Please try again."),
      values,
    };
  }

  revalidateApprovals(approval.project_id, approval.asset_id);
  if (approval.asset_id) revalidatePath(`/portal/projects/${approval.project_id}/files/${approval.asset_id}`);
  return {
    status: "success",
    message:
      d.decision === "approved"
        ? "Approved. The team has been notified."
        : "Changes requested. The team has been notified.",
  };
}
