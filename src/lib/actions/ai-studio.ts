"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateScript } from "@/lib/ai/service";
import { normalizeEditedScript } from "@/lib/ai/studio";
import { dbErrorMessage } from "@/lib/db-errors";
import { isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { optionalText, optionalUuid } from "@/lib/validation/common";
import { getWorkspaceContext } from "@/lib/workspace";
import type { Json } from "@/types/database";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const NO_ACCESS = "Only the team can use AI Studio.";
const generationIdSchema = z.uuid();
const detailsSchema = z.object({
  generationId: z.uuid(),
  title: optionalText(200, "Title"),
  projectId: optionalUuid,
});

function revalidateStudio(generationId?: string) {
  revalidatePath("/app/ai-studio");
  if (generationId) revalidatePath(`/app/ai-studio/${generationId}`);
}

/**
 * Generates a script from the brief form. The work (authorization, limits,
 * the Claude call and recording the result) happens in generateScript() on
 * the server; this only adapts it to the form.
 */
export async function generateScriptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echoValues(formData);
  const outcome = await generateScript(Object.fromEntries(formData));
  if (outcome.ok) {
    revalidateStudio();
    redirect(`/app/ai-studio/${outcome.generationId}`);
  }
  if (outcome.generationId) revalidateStudio(outcome.generationId);
  return {
    status: "error",
    message: outcome.message,
    fieldErrors: outcome.fieldErrors,
    values,
    data: { code: outcome.code, ...(outcome.generationId ? { generationId: outcome.generationId } : {}) },
  };
}

/** Saves an edited script (the creator or a manager; the database enforces it too). */
export async function saveScriptDocument(generationId: string, script: unknown): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  if (!generationIdSchema.safeParse(generationId).success) return { ok: false, error: "Invalid script." };
  const checked = normalizeEditedScript(script);
  if (!checked.ok) return { ok: false, error: checked.errors.join(" · ") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_generations")
    .update({ document: checked.script as Json })
    .eq("id", generationId)
    .eq("workspace_id", active.id)
    .eq("kind", "script")
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Couldn't save the script. Please try again.") };
  if (!data.length) {
    return { ok: false, error: "Only the person who generated this script or a manager can edit it." };
  }
  revalidateStudio(generationId);
  return { ok: true, message: "Script saved." };
}

/** Renames a generation or links it to a project. */
export async function updateGenerationDetails(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!isStaff(active.role)) return { status: "error", message: NO_ACCESS, values };
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const d = parsed.data;

  const supabase = await createClient();
  if (d.projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", d.projectId)
      .eq("workspace_id", active.id)
      .maybeSingle();
    if (!project)
      return { status: "error", fieldErrors: { projectId: ["Choose a project from this workspace"] }, values };
  }
  const { data, error } = await supabase
    .from("ai_generations")
    .update({ title: d.title ?? null, project_id: d.projectId ?? null })
    .eq("id", d.generationId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { status: "error", message: dbErrorMessage(error, "Couldn't save the details."), values };
  if (!data.length) {
    return { status: "error", message: "Only the person who generated this or a manager can change it.", values };
  }
  revalidateStudio(d.generationId);
  return { status: "success", message: "Details saved." };
}

/** Deletes a generation (the creator or a manager). Its usage history is kept. */
export async function deleteGeneration(generationId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS };
  if (!generationIdSchema.safeParse(generationId).success) return { ok: false, error: "Invalid script." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_generations")
    .delete()
    .eq("id", generationId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Couldn't delete it. Please try again.") };
  if (!data.length) return { ok: false, error: "Only the person who generated this or a manager can delete it." };
  revalidateStudio();
  redirect("/app/ai-studio");
}
