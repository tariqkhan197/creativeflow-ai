import { describe, expect, it } from "vitest";
import { planAssetDeletion, type DeletableAsset } from "./deletion";

const rows: DeletableAsset[] = [
  { id: "r", root_asset_id: null, storage_path: "w/p/r/cut.mp4", uploaded_by: "me" },
  { id: "v2", root_asset_id: "r", storage_path: "w/p/v2/cut-v2.mp4", uploaded_by: "me" },
  { id: "v3", root_asset_id: "r", storage_path: "w/p/v3/cut-v3.mp4", uploaded_by: "other" },
  { id: "x", root_asset_id: null, storage_path: "w/p/x/still.png", uploaded_by: "other" },
];
const me = { userId: "me", canManage: false };
const manager = { userId: "boss", canManage: true };

describe("planAssetDeletion", () => {
  it("deletes an original with every version's file and thumbnail", () => {
    const plan = planAssetDeletion(rows, "v2", "all", manager);
    expect(plan).toEqual({
      ok: true,
      rowIdToDelete: "r",
      count: 3,
      folders: ["w/p/r", "w/p/v2", "w/p/v3"],
      storagePaths: [
        "w/p/r/cut.mp4",
        "w/p/r/thumbnail.jpg",
        "w/p/v2/cut-v2.mp4",
        "w/p/v2/thumbnail.jpg",
        "w/p/v3/cut-v3.mp4",
        "w/p/v3/thumbnail.jpg",
      ],
    });
  });

  it("deletes a single newer version only", () => {
    const plan = planAssetDeletion(rows, "v2", "version", me);
    expect(plan).toMatchObject({
      ok: true,
      rowIdToDelete: "v2",
      count: 1,
      storagePaths: ["w/p/v2/cut-v2.mp4", "w/p/v2/thumbnail.jpg"],
    });
  });

  it("protects the original while newer versions exist", () => {
    expect(planAssetDeletion(rows, "r", "version", manager)).toMatchObject({ ok: false });
  });

  it("stops non-managers from deleting other people's files", () => {
    expect(planAssetDeletion(rows, "r", "all", me)).toMatchObject({ ok: false });
    expect(planAssetDeletion(rows, "x", "all", me)).toMatchObject({ ok: false });
    expect(planAssetDeletion(rows, "v3", "version", { userId: "other", canManage: false })).toMatchObject({ ok: true });
  });

  it("reports missing files", () =>
    expect(planAssetDeletion(rows, "nope", "all", manager)).toMatchObject({ ok: false }));
});
