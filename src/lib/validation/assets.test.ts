import { describe, expect, it } from "vitest";
import { createAssetUploadSchema, finalizeAssetSchema, renameAssetSchema } from "./assets";

const id = "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60";

describe("asset schemas", () => {
  it("validates upload requests", () => {
    expect(createAssetUploadSchema.parse({ projectId: id, fileName: " a.mp4 ", size: "1024" })).toEqual({
      projectId: id,
      fileName: "a.mp4",
      size: 1024,
      browserMime: "",
    });
    expect(createAssetUploadSchema.safeParse({ projectId: id, fileName: "a.mp4", size: 0 }).success).toBe(false);
    expect(createAssetUploadSchema.safeParse({ projectId: id, fileName: "a.mp4", size: 1.5 }).success).toBe(false);
    expect(createAssetUploadSchema.safeParse({ projectId: "x", fileName: "a.mp4", size: 1 }).success).toBe(false);
    expect(
      createAssetUploadSchema.safeParse({ projectId: id, fileName: "a.mp4", size: 1, rootAssetId: "nope" }).success,
    ).toBe(false);
  });

  it("drops unknown metadata instead of inventing it", () => {
    expect(finalizeAssetSchema.parse({ assetId: id, durationSeconds: "", width: null, frameRate: undefined })).toEqual({
      assetId: id,
      durationSeconds: undefined,
      width: undefined,
      height: undefined,
      frameRate: undefined,
    });
    expect(
      finalizeAssetSchema.parse({ assetId: id, durationSeconds: 12.5, width: 1920, height: 1080, frameRate: 29.97 }),
    ).toMatchObject({
      durationSeconds: 12.5,
      frameRate: 29.97,
    });
    expect(finalizeAssetSchema.safeParse({ assetId: id, width: -1 }).success).toBe(false);
    expect(finalizeAssetSchema.safeParse({ assetId: id, durationSeconds: Infinity }).success).toBe(false);
  });

  it("validates renames", () => {
    expect(renameAssetSchema.safeParse({ assetId: id, name: "  " }).success).toBe(false);
    expect(renameAssetSchema.safeParse({ assetId: id, name: "x".repeat(256) }).success).toBe(false);
  });
});
