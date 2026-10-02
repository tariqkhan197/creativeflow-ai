"use server";

import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/db-errors";
import { isStaff } from "@/lib/permissions";
import type { CommentRecord } from "@/lib/review/threads";
import { createClient } from "@/lib/supabase/server";
import { assetIdSchema } from "@/lib/validation/assets";
import {
  addCommentSchema,
  commentIdSchema,
  editCommentSchema,
  replySchema,
  resolveCommentSchema,
} from "@/lib/validation/comments";
import { getWorkspaceContext } from "@/lib/workspace";
import type { ActionResult } from "./types";

export type CommentResult = { ok: true; comment: CommentRecord } | { ok: false; error: string };

const COLUMNS =
  "id, asset_id, parent_id, author_id, body, timestamp_seconds, annotation, is_internal, resolved_at, resolved_by, edited_at, created_at, updated_at";

function touch(projectId?: string) {
  revalidatePath("/app/reviews");
  if (projectId) revalidatePath(`/app/projects/${projectId}`);
}

export async function addComment(input: unknown): Promise<CommentResult> {
  const { user, active } = await getWorkspaceContext();
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  const d = parsed.data;
  if (d.isInternal && !isStaff(active.role)) return { ok: false, error: "Only the team can add internal notes." };

  const supabase = await createClient();
  // The asset must be in the active workspace (RLS also limits it to what the caller may view).
  const { data: asset } = await supabase
    .from("assets")
    .select("id, project_id")
    .eq("id", d.assetId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (!asset) return { ok: false, error: "This file no longer exists." };

  const { data, error } = await supabase
    .from("review_comments")
    .insert({
      workspace_id: active.id,
      asset_id: asset.id,
      author_id: user.id,
      body: d.body,
      timestamp_seconds: d.timestampSeconds,
      annotation: d.annotation,
      is_internal: d.isInternal,
    })
    .select(COLUMNS)
    .single();
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not post the comment. Please try again.") };
  touch(asset.project_id);
  return { ok: true, comment: data as CommentRecord };
}

export async function replyToComment(input: unknown): Promise<CommentResult> {
  const { user, active } = await getWorkspaceContext();
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid reply." };
  if (parsed.data.isInternal && !isStaff(active.role))
    return { ok: false, error: "Only the team can add internal notes." };

  const supabase = await createClient();
  const { data: parent } = await supabase
    .from("review_comments")
    .select("id, asset_id, parent_id")
    .eq("id", parsed.data.parentId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (!parent) return { ok: false, error: "This comment no longer exists." };
  if (parent.parent_id) return { ok: false, error: "Reply to the main comment instead." };

  const { data, error } = await supabase
    .from("review_comments")
    .insert({
      workspace_id: active.id,
      asset_id: parent.asset_id,
      parent_id: parent.id,
      author_id: user.id,
      body: parsed.data.body,
      is_internal: parsed.data.isInternal,
    })
    .select(COLUMNS)
    .single();
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not post the reply. Please try again.") };
  touch();
  return { ok: true, comment: data as CommentRecord };
}

export async function editComment(input: unknown): Promise<CommentResult> {
  const { user, active } = await getWorkspaceContext();
  const parsed = editCommentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_comments")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .eq("workspace_id", active.id)
    .eq("author_id", user.id)
    .select(COLUMNS);
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not save the comment.") };
  if (!data.length) return { ok: false, error: "Only the author can edit this comment." };
  return { ok: true, comment: data[0] as CommentRecord };
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  const { active } = await getWorkspaceContext();
  const parsed = commentIdSchema.safeParse({ commentId });
  if (!parsed.success) return { ok: false, error: "Invalid comment." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_comments")
    .delete()
    .eq("id", parsed.data.commentId)
    .eq("workspace_id", active.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not delete the comment.") };
  if (!data.length) return { ok: false, error: "Only the author or a manager can delete this comment." };
  touch();
  return { ok: true };
}

export async function setCommentResolved(input: unknown): Promise<CommentResult> {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: "Only the team can resolve comments." };
  const parsed = resolveCommentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid comment." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_comments")
    // The database sets resolved_at/resolved_by itself; this only flips the state.
    .update({ resolved_at: parsed.data.resolved ? new Date().toISOString() : null })
    .eq("id", parsed.data.commentId)
    .eq("workspace_id", active.id)
    .is("parent_id", null)
    .select(COLUMNS);
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not update the comment.") };
  if (!data.length) return { ok: false, error: "This comment no longer exists." };
  touch();
  return { ok: true, comment: data[0] as CommentRecord };
}

/** Current comments on an asset (RLS-scoped), used to re-sync after a Realtime reconnect. */
export async function listComments(
  assetId: string,
): Promise<{ ok: true; comments: CommentRecord[] } | { ok: false; error: string }> {
  const { active } = await getWorkspaceContext();
  const parsed = assetIdSchema.safeParse({ assetId });
  if (!parsed.success) return { ok: false, error: "Invalid file." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_comments")
    .select(COLUMNS)
    .eq("asset_id", assetId)
    .eq("workspace_id", active.id)
    .order("created_at");
  if (error) return { ok: false, error: "Comments couldn't be refreshed." };
  return { ok: true, comments: data as CommentRecord[] };
}
