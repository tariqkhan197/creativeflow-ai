"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE, ACTIVE_WORKSPACE_COOKIE_OPTIONS as COOKIE_OPTIONS } from "@/lib/cookies";
import { ADMIN_ROLES, getUserWorkspaces } from "@/lib/workspace";
import { createWorkspaceSchema, updateProfileSchema, updateWorkspaceSchema } from "@/lib/validation/workspace";
import { echoValues, fieldErrorsFrom, type FormState } from "./types";

export async function createWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/onboarding");
  const values = echoValues(formData);
  const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", fieldErrors: { slug: ["This URL is already taken"] }, values };
    }
    if (error.code === "54000") {
      return { status: "error", message: "You have reached the limit of 10 workspaces.", values };
    }
    return { status: "error", message: "Could not create the workspace. Please try again.", values };
  }

  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, workspaceId, COOKIE_OPTIONS);
  redirect("/app");
}

export async function switchWorkspace(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) return { ok: false, error: "Invalid workspace" };

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.some((w) => w.id === id.data)) return { ok: false, error: "You are not a member of that workspace" };

  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, id.data, COOKIE_OPTIONS);
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function updateWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = echoValues(formData);
  const parsed = updateWorkspaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const ws = (await getUserWorkspaces(user.id)).find((w) => w.id === parsed.data.workspaceId);
  if (!ws || !ADMIN_ROLES.includes(ws.role)) {
    return { status: "error", message: "Only owners and admins can change workspace settings.", values };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.workspaceId);
  if (error) return { status: "error", message: "Could not save the workspace. Please try again.", values };

  revalidatePath("/app", "layout");
  return { status: "success", message: "Workspace updated." };
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = echoValues(formData);
  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, job_title: parsed.data.jobTitle || null })
    .eq("id", user.id);
  if (error) return { status: "error", message: "Could not save your profile. Please try again.", values };

  revalidatePath("/app", "layout");
  return { status: "success", message: "Profile updated." };
}
