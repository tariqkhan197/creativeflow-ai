"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbErrorMessage } from "@/lib/db-errors";
import { canManageWork } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { clientIdSchema, clientSchema, updateClientSchema } from "@/lib/validation/clients";
import { getWorkspaceContext } from "@/lib/workspace";
import { echoValues, fieldErrorsFrom, type ActionResult, type FormState } from "./types";

const NOT_ALLOWED = "Only owners, admins and managers can manage clients.";

function toRow(data: { name: string; company?: string; email?: string; phone?: string; notes?: string }) {
  return {
    name: data.name,
    company: data.company ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    notes: data.notes ?? null,
  };
}

export async function createClientRecord(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canManageWork(active.role)) return { status: "error", message: NOT_ALLOWED, values };

  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...toRow(parsed.data), workspace_id: active.id, created_by: user.id })
    .select("id")
    .single();
  if (error)
    return { status: "error", message: dbErrorMessage(error, "Could not save the client. Please try again."), values };

  revalidatePath("/app/clients");
  revalidatePath("/app");
  return { status: "success", message: `${parsed.data.name} added.`, data: { id: data.id } };
}

export async function updateClientRecord(_prev: FormState, formData: FormData): Promise<FormState> {
  const { active } = await getWorkspaceContext();
  const values = echoValues(formData);
  if (!canManageWork(active.role)) return { status: "error", message: NOT_ALLOWED, values };

  const parsed = updateClientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update(toRow(parsed.data))
    .eq("id", parsed.data.clientId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error)
    return { status: "error", message: dbErrorMessage(error, "Could not save the client. Please try again."), values };
  if (!data.length) return { status: "error", message: "This client no longer exists.", values };

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${parsed.data.clientId}`);
  return { status: "success", message: "Client updated." };
}

export async function deleteClientRecord(clientId: string, redirectToList = false): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  if (!canManageWork(active.role)) return { ok: false, error: NOT_ALLOWED };
  const parsed = clientIdSchema.safeParse({ clientId });
  if (!parsed.success) return { ok: false, error: "Invalid client." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", parsed.data.clientId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) {
    // invoices.client_id is ON DELETE RESTRICT
    if (error.code === "23503") return { ok: false, error: "This client has invoices, so it can't be deleted." };
    return { ok: false, error: dbErrorMessage(error, "Could not delete the client.") };
  }
  if (!data.length) return { ok: false, error: "This client no longer exists." };

  revalidatePath("/app/clients");
  revalidatePath("/app");
  if (redirectToList) redirect("/app/clients");
  return { ok: true, message: "Client deleted. Its projects were kept without a client." };
}
