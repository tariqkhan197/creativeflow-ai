import type { Asset } from "@/types/database";

export type AssetListRow = Pick<
  Asset,
  | "id"
  | "name"
  | "kind"
  | "status"
  | "mime_type"
  | "size_bytes"
  | "duration_seconds"
  | "version_number"
  | "root_asset_id"
  | "thumbnail_path"
  | "uploaded_by"
  | "upload_error"
  | "created_at"
>;

export type AssetGroup = {
  rootId: string;
  /** Newest ready version (what reviewers open by default). */
  latest: AssetListRow;
  /** All ready versions, newest first. */
  versions: AssetListRow[];
};

/**
 * Groups asset rows into originals with their ready versions, plus
 * unfinished uploads (uploading / failed) listed separately.
 */
export function groupAssets(rows: AssetListRow[]): { groups: AssetGroup[]; unfinished: AssetListRow[] } {
  const ready = rows.filter((r) => r.status === "ready");
  const byRoot = new Map<string, AssetListRow[]>();
  for (const r of ready) {
    const root = r.root_asset_id ?? r.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
  }
  const groups = [...byRoot.entries()]
    .map(([rootId, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
      return { rootId, latest: sorted[0], versions: sorted };
    })
    .sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
  const unfinished = rows.filter((r) => r.status !== "ready").sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { groups, unfinished };
}
