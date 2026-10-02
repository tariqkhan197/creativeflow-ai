"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { dbErrorMessage } from "@/lib/db-errors";
import { isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { taskIdSchema, taskSchema, taskStatusSchema, updateTaskSchema } from "@/lib/validation/tasks";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const NO_ACCESS = "Only team members can manage tasks.";

function toRow(d: z.infer<typeof taskSchema>) {
  return {
    title: d.title,
    description: d.description ?? null,
    status: d.status,
    assignee_id: d.assigneeId ?? null,
    due_date: d.dueDate ?? null,
  };
}

async function projectInWorkspace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  workspaceId: string,
) {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

function assigneeError(error: { code?: string; message?: string }) {
  return error.code === "23514" && /assignee/i.test(error.message ?? "")
    ? { assigneeId: ["Choose someone on this workspace's team"] }
    : undefined;
}

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!isStaff(active.role)) return { status: "error", message: NO_ACCESS, values };
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  if (!(await projectInWorkspace(supabase, parsed.data.projectId, active.id))) {
    return { status: "error", message: "This project no longer exists.", values };
  }
  const { error } = await supabase.from("tasks").insert({
    ...toRow(parsed.data),
    workspace_id: active.id,
    project_id: parsed.data.projectId,
    created_by: user.id,
  });
  if (error) {
    const fieldErrors = assigneeError(error);
    if (fieldErrors) return { status: "error", fieldErrors, values };
    return { status: "error", message: dbErrorMessage(error, "Could not add the task. Please try again."), values };
  }

  revalidatePath(`/app/projects/${parsed.data.projectId}`);
  revalidatePath("/app/projects");
  return { status: "success", message: "Task added." };
}

export async function updateTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!isStaff(active.role)) return { status: "error", message: NO_ACCESS, values };
  const parsed = updateTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(toRow(parsed.data))
    .eq("id", parsed.data.taskId)
    .eq("project_id", parsed.data.projectId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) {
    const fieldErrors = assigneeError(error);
    if (fieldErrors) return { status: "error", fieldErrors, values };
    return { status: "error", message: dbErrorMessage(error, "Could not save the task. Please try again."), values };
  }
  if (!data.length) return { status: "error", message: "This task no longer exists.", values };

  revalidatePath(`/app/projects/${parsed.data.projectId}`);
  return { status: "success", message: "Task saved." };
}

export async function setTaskStatus(taskId: string, status: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  const parsed = taskStatusSchema.safeParse({ taskId, status });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.taskId)
    .eq("workspace_id", active.id)
    .select("project_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not move the task.") };
  if (!data.length) return { ok: false, error: "This task no longer exists." };

  revalidatePath(`/app/projects/${data[0].project_id}`);
  revalidatePath("/app/projects");
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  const parsed = taskIdSchema.safeParse({ taskId });
  if (!parsed.success) return { ok: false, error: "Invalid task." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", parsed.data.taskId)
    .eq("workspace_id", active.id)
    .select("project_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not delete the task.") };
  // RLS: only the task's creator or a manager may delete.
  if (!data.length) return { ok: false, error: "Only the person who created this task, or a manager, can delete it." };

  revalidatePath(`/app/projects/${data[0].project_id}`);
  revalidatePath("/app/projects");
  return { ok: true, message: "Task deleted." };
}
