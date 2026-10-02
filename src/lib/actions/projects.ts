"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { dbErrorMessage } from "@/lib/db-errors";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  projectIdSchema,
  projectMemberSchema,
  projectSchema,
  projectStatusSchema,
  updateProjectSchema,
} from "@/lib/validation/projects";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

type ProjectInput = z.infer<typeof projectSchema>;

function toRow(d: ProjectInput) {
  return {
    name: d.name,
    description: d.description ?? null,
    client_id: d.clientId ?? null,
    status: d.status,
    priority: d.priority,
    start_date: d.startDate ?? null,
    due_date: d.dueDate ?? null,
    budget_cents: d.budget ?? null,
    currency: d.currency,
  };
}

/** The client must belong to the active workspace (also enforced by a composite FK). */
async function clientBelongs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  clientId?: string,
) {
  if (!clientId) return true;
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

function revalidateProject(id?: string) {
  revalidatePath("/app/projects");
  revalidatePath("/app");
  if (id) revalidatePath(`/app/projects/${id}`);
}

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canManageWork(active.role)) {
    return { status: "error", message: "Only owners, admins and managers can create projects.", values };
  }
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  if (!(await clientBelongs(supabase, active.id, parsed.data.clientId))) {
    return { status: "error", fieldErrors: { clientId: ["Choose a client from this workspace"] }, values };
  }
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...toRow(parsed.data), workspace_id: active.id, created_by: user.id })
    .select("id")
    .single();
  if (error)
    return {
      status: "error",
      message: dbErrorMessage(error, "Could not create the project. Please try again."),
      values,
    };

  revalidateProject();
  redirect(`/app/projects/${data.id}`);
}

export async function updateProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!isStaff(active.role)) return { status: "error", message: "You don't have access to this project.", values };
  const parsed = updateProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  if (!(await clientBelongs(supabase, active.id, parsed.data.clientId))) {
    return { status: "error", fieldErrors: { clientId: ["Choose a client from this workspace"] }, values };
  }
  const { data, error } = await supabase
    .from("projects")
    .update(toRow(parsed.data))
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error)
    return { status: "error", message: dbErrorMessage(error, "Could not save the project. Please try again."), values };
  if (!data.length) return { status: "error", message: "This project no longer exists.", values };

  revalidateProject(parsed.data.projectId);
  return { status: "success", message: "Project saved." };
}

export async function setProjectStatus(projectId: string, status: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: "You don't have access to this project." };
  const parsed = projectStatusSchema.safeParse({ projectId, status });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not update the status.") };
  if (!data.length) return { ok: false, error: "This project no longer exists." };

  revalidateProject(parsed.data.projectId);
  return { ok: true, message: "Status updated." };
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManageWork(active.role))
    return { ok: false, error: "Only owners, admins and managers can archive projects." };
  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { ok: false, error: "Invalid project." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not update the project.") };
  if (!data.length) return { ok: false, error: "This project no longer exists." };

  revalidateProject(parsed.data.projectId);
  return { ok: true, message: archived ? "Project archived." : "Project restored." };
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManageWork(active.role)) return { ok: false, error: "Only owners, admins and managers can delete projects." };
  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { ok: false, error: "Invalid project." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not delete the project.") };
  if (!data.length) return { ok: false, error: "This project no longer exists." };

  revalidateProject();
  redirect("/app/projects");
}

export async function addProjectMember(projectId: string, userId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManageWork(active.role))
    return { ok: false, error: "Only owners, admins and managers can change the project team." };
  const parsed = projectMemberSchema.safeParse({ projectId, userId });
  if (!parsed.success) return { ok: false, error: "Invalid selection." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: parsed.data.projectId, workspace_id: active.id, user_id: parsed.data.userId });
  if (error) {
    if (error.code === "23505") return { ok: true };
    return { ok: false, error: dbErrorMessage(error, "Could not add this person to the project.") };
  }
  revalidatePath(`/app/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Added to the project team." };
}

export async function removeProjectMember(projectId: string, userId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManageWork(active.role))
    return { ok: false, error: "Only owners, admins and managers can change the project team." };
  const parsed = projectMemberSchema.safeParse({ projectId, userId });
  if (!parsed.success) return { ok: false, error: "Invalid selection." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .eq("user_id", parsed.data.userId);
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not update the project team.") };
  revalidatePath(`/app/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Removed from the project team." };
}
