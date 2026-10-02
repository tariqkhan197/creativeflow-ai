"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/app", "layout");
  revalidatePath("/portal", "layout");
  return { ok: !error };
}

export async function markAllNotificationsRead(workspaceId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(workspaceId);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", parsed.data)
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/app", "layout");
  revalidatePath("/portal", "layout");
  return { ok: !error };
}
