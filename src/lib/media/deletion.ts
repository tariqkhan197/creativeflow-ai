import { thumbnailPathFor } from "@/lib/media/file-types";

export type DeletableAsset = {
  id: string;
  root_asset_id: string | null;
  storage_path: string;
  uploaded_by: string | null;
};

export type DeletionPlan =
  | { ok: true; rowIdToDelete: string; storagePaths: string[]; folders: string[]; count: number }
  | { ok: false; error: string };

/**
 * Plans deleting either one version, or an original with all its versions.
 * Storage only lets managers or a file's uploader remove it, so a
 * non-manager may only delete files they uploaded themselves.
 */
export function planAssetDeletion(
  rows: DeletableAsset[],
  targetId: string,
  scope: "version" | "all",
  actor: { userId: string; canManage: boolean },
): DeletionPlan {
  const target = rows.find((r) => r.id === targetId);
  if (!target) return { ok: false, error: "This file no longer exists." };

  const rootId = target.root_asset_id ?? target.id;
  let affected: DeletableAsset[];
  if (scope === "all") {
    affected = rows.filter((r) => r.id === rootId || r.root_asset_id === rootId);
  } else {
    if (target.root_asset_id === null && rows.some((r) => r.root_asset_id === target.id)) {
      return { ok: false, error: "This is the original. Delete the whole file, or delete the newer versions first." };
    }
    affected = [target];
  }

  if (!actor.canManage && affected.some((r) => r.uploaded_by !== actor.userId)) {
    return { ok: false, error: "Only managers can delete files that include versions uploaded by someone else." };
  }

  const storagePaths = affected.flatMap((r) => [r.storage_path, thumbnailPathFor(r.storage_path)]);
  const folders = affected.map((r) => r.storage_path.replace(/\/[^/]+$/, ""));
  return {
    ok: true,
    rowIdToDelete: scope === "all" ? rootId : target.id,
    storagePaths,
    folders,
    count: affected.length,
  };
}
