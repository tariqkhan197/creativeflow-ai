import { describe, expect, it } from "vitest";
import { groupAssets, type AssetListRow } from "./asset-groups";

const row = (id: string, extra: Partial<AssetListRow> = {}): AssetListRow => ({
  id,
  name: id,
  kind: "video",
  status: "ready",
  mime_type: "video/mp4",
  size_bytes: 1,
  duration_seconds: null,
  version_number: 1,
  root_asset_id: null,
  thumbnail_path: null,
  uploaded_by: "u",
  upload_error: null,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});

describe("groupAssets", () => {
  it("groups versions under their original with the newest ready version first", () => {
    const { groups, unfinished } = groupAssets([
      row("a"),
      row("a2", { root_asset_id: "a", version_number: 2, created_at: "2026-10-02T00:00:00Z" }),
      row("a3", { root_asset_id: "a", version_number: 3, status: "uploading", created_at: "2026-10-03T00:00:00Z" }),
      row("b", { created_at: "2026-09-01T00:00:00Z" }),
    ]);
    expect(groups.map((g) => [g.rootId, g.latest.id, g.versions.length])).toEqual([
      ["a", "a2", 2],
      ["b", "b", 1],
    ]);
    expect(unfinished.map((u) => u.id)).toEqual(["a3"]);
  });

  it("lists unfinished originals separately and never as reviewable", () => {
    const { groups, unfinished } = groupAssets([row("x", { status: "failed" }), row("y", { status: "uploading" })]);
    expect(groups).toEqual([]);
    expect(unfinished.map((u) => u.id).sort()).toEqual(["x", "y"]);
  });
});
