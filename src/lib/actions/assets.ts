"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/db-errors";
import { getSupabasePublicConfig } from "@/lib/env/public";
import {
  buildStoragePath,
  checkFileSize,
  displayName,
  resolveFileType,
  resumableEndpoint,
  thumbnailPathFor,
} from "@/lib/media/file-types";
import { ASSET_BUCKET, getUploadLimit } from "@/lib/media/server";
import { isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  assetIdSchema,
  createAssetUploadSchema,
  finalizeAssetSchema,
  uploadFailureSchema,
} from "@/lib/validation/assets";
import { getWorkspaceContext } from "@/lib/workspace";
import type { AssetKind } from "@/types/database";
import type { ActionResult } from "./types";

export type UploadTarget = {
  assetId: string;
  projectId: string;
  bucket: string;
  objectName: string;
  thumbnailObjectName: string;
  contentType: string;
  kind: AssetKind;
  endpoint: string;
};

export type UploadTargetResult = { ok: true; target: UploadTarget } | { ok: false; error: string; retryable: boolean };

const NO_ACCESS = "Only team members can upload files.";

function targetFor(row: {
  id: string;
  project_id: string;
  storage_path: string;
  mime_type: string;
  kind: AssetKind;
}): UploadTarget {
  return {
    assetId: row.id,
    projectId: row.project_id,
    bucket: ASSET_BUCKET,
    objectName: row.storage_path,
    thumbnailObjectName: thumbnailPathFor(row.storage_path),
    contentType: row.mime_type,
    kind: row.kind,
    endpoint: resumableEndpoint(getSupabasePublicConfig().url),
  };
}

/**
 * Validates the file and creates the asset row (status "uploading") before any
 * bytes are sent. Workspace and project come from the server, never the client.
 */
export async function createAssetUpload(input: unknown): Promise<UploadTargetResult> {
  const { user, active } = await getWorkspaceContext();
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS, retryable: false };
  const parsed = createAssetUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This upload request is invalid.", retryable: false };
  const { projectId, fileName, size, browserMime, rootAssetId } = parsed.data;

  const type = resolveFileType(fileName, browserMime);
  if (!type.ok) return { ok: false, error: type.error, retryable: false };

  const supabase = await createClient();
  const limit = await getUploadLimit(supabase);
  const sizeError = checkFileSize(size, limit.bytes);
  if (sizeError) return { ok: false, error: sizeError, retryable: false };

  const { data: project } = await supabase
    .from("projects")
    .select("id, archived_at")
    .eq("id", projectId)
    .eq("workspace_id", active.id)
    .maybeSingle();
  if (!project) return { ok: false, error: "This project no longer exists.", retryable: false };
  if (project.archived_at)
    return { ok: false, error: "Restore this project before uploading files.", retryable: false };

  if (rootAssetId) {
    const { data: root } = await supabase
      .from("assets")
      .select("id, project_id, root_asset_id, kind, status")
      .eq("id", rootAssetId)
      .eq("workspace_id", active.id)
      .maybeSingle();
    if (!root || root.project_id !== project.id || root.root_asset_id !== null) {
      return { ok: false, error: "The original file for this version no longer exists.", retryable: false };
    }
    if (root.status !== "ready")
      return { ok: false, error: "Wait for the original upload to finish first.", retryable: false };
    if (root.kind !== type.type.kind) {
      return { ok: false, error: `A new version must also be a ${root.kind} file.`, retryable: false };
    }
  }

  const id = randomUUID();
  const row = {
    id,
    workspace_id: active.id,
    project_id: project.id,
    name: displayName(fileName),
    kind: type.type.kind,
    storage_path: buildStoragePath(active.id, project.id, id, fileName),
    mime_type: type.type.mime,
    size_bytes: size,
    uploaded_by: user.id,
    root_asset_id: rootAssetId ?? null,
  };
  const { error } = await supabase.from("assets").insert(row);
  if (error)
    return {
      ok: false,
      error: dbErrorMessage(error, "Could not start the upload. Please try again."),
      retryable: false,
    };

  revalidatePath(`/app/projects/${project.id}`);
  return { ok: true, target: targetFor(row) };
}

async function ownUpload(assetId: string) {
  const { user, active } = await getWorkspaceContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("assets")
    .select("id, project_id, storage_path, mime_type, kind, status, uploaded_by")
    .eq("id", assetId)
    .eq("workspace_id", active.id)
    .eq("uploaded_by", user.id)
    .maybeSingle();
  return { supabase, active, asset: data };
}

/** Re-opens a failed upload on the same record and storage path (no duplicates). */
export async function retryAssetUpload(assetId: string): Promise<UploadTargetResult> {
  const parsed = assetIdSchema.safeParse({ assetId });
  if (!parsed.success) return { ok: false, error: "Invalid upload.", retryable: false };
  const { supabase, active, asset } = await ownUpload(parsed.data.assetId);
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS, retryable: false };
  if (!asset) return { ok: false, error: "This upload no longer exists.", retryable: false };
  if (asset.status === "ready") return { ok: false, error: "This file has already been uploaded.", retryable: false };

  if (asset.status === "failed") {
    const { error } = await supabase
      .from("assets")
      .update({ status: "uploading", upload_error: null })
      .eq("id", asset.id);
    if (error) return { ok: false, error: dbErrorMessage(error, "Could not restart the upload."), retryable: true };
  }
  return { ok: true, target: targetFor(asset) };
}

export async function markAssetUploadFailed(input: { assetId: string; message: string }): Promise<ActionResult> {
  const parsed = uploadFailureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const { supabase, asset } = await ownUpload(parsed.data.assetId);
  if (!asset) return { ok: false, error: "This upload no longer exists." };
  if (asset.status !== "uploading") return { ok: true };

  const { error } = await supabase
    .from("assets")
    .update({ status: "failed", upload_error: parsed.data.message })
    .eq("id", asset.id)
    .eq("status", "uploading");
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not record the upload failure.") };
  revalidatePath(`/app/projects/${asset.project_id}`);
  return { ok: true };
}

export type FinalizeResult = { ok: true; thumbnail: boolean } | { ok: false; error: string; retryable: boolean };

/**
 * Marks an upload ready. The database verifies the stored object's real size
 * and type before accepting it; metadata is only what the browser measured.
 */
export async function finalizeAssetUpload(input: unknown): Promise<FinalizeResult> {
  const parsed = finalizeAssetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload details.", retryable: false };
  const { supabase, active, asset } = await ownUpload(parsed.data.assetId);
  if (!isStaff(active.role)) return { ok: false, error: NO_ACCESS, retryable: false };
  if (!asset) return { ok: false, error: "This upload no longer exists.", retryable: false };

  const { data, error } = await supabase.rpc("finalize_asset_upload", {
    p_asset: asset.id,
    p_duration_seconds: parsed.data.durationSeconds ?? null,
    p_width: parsed.data.width ? Math.round(parsed.data.width) : null,
    p_height: parsed.data.height ? Math.round(parsed.data.height) : null,
    p_frame_rate: parsed.data.frameRate ?? null,
  });
  if (error) {
    const message = dbErrorMessage(error, "Could not finish the upload.");
    // The stored file doesn't match: record it so the upload can be retried.
    if (error.code === "22023") {
      await supabase
        .from("assets")
        .update({ status: "failed", upload_error: message.slice(0, 500) })
        .eq("id", asset.id)
        .eq("status", "uploading");
    }
    revalidatePath(`/app/projects/${asset.project_id}`);
    return { ok: false, error: message, retryable: true };
  }

  revalidatePath(`/app/projects/${asset.project_id}`);
  revalidatePath("/app/reviews");
  return { ok: true, thumbnail: Boolean(data?.thumbnail) };
}

/**
 * Cancels an unfinished upload: removes whatever reached Storage, then the
 * record. If Storage can't be cleaned, the record is kept so it can be retried.
 */
export async function cancelAssetUpload(assetId: string): Promise<ActionResult> {
  const parsed = assetIdSchema.safeParse({ assetId });
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const { supabase, asset } = await ownUpload(parsed.data.assetId);
  if (!asset) return { ok: true };
  if (asset.status === "ready") return { ok: false, error: "This file has finished uploading. Delete it instead." };

  const { error: storageError } = await supabase.storage
    .from(ASSET_BUCKET)
    .remove([asset.storage_path, thumbnailPathFor(asset.storage_path)]);
  if (storageError) return { ok: false, error: "Could not remove the partial upload from storage. Please try again." };

  const { error } = await supabase.from("assets").delete().eq("id", asset.id);
  if (error) return { ok: false, error: dbErrorMessage(error, "Could not cancel the upload.") };
  revalidatePath(`/app/projects/${asset.project_id}`);
  return { ok: true };
}
