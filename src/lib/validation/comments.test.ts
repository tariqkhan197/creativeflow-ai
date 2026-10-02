import { describe, expect, it } from "vitest";
import { addCommentSchema, editCommentSchema, replySchema, timestampError } from "./comments";

const id = "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60";

describe("comment schemas", () => {
  it("accepts a timestamped comment with a pin", () => {
    expect(
      addCommentSchema.parse({ assetId: id, body: " Logo ", timestampSeconds: 12.5, annotation: { x: 0.2, y: 0.9 } }),
    ).toEqual({
      assetId: id,
      body: "Logo",
      timestampSeconds: 12.5,
      annotation: { x: 0.2, y: 0.9 },
      isInternal: false,
    });
  });
  it("enforces the 5,000-character limit and non-empty text", () => {
    expect(addCommentSchema.safeParse({ assetId: id, body: "x".repeat(5000) }).success).toBe(true);
    expect(addCommentSchema.safeParse({ assetId: id, body: "x".repeat(5001) }).success).toBe(false);
    expect(replySchema.safeParse({ parentId: id, body: "   " }).success).toBe(false);
    expect(editCommentSchema.safeParse({ commentId: id, body: "" }).success).toBe(false);
  });
  it("rejects malformed pins and timestamps", () => {
    for (const annotation of [{ x: 1.2, y: 0 }, { x: 0.1 }, { x: 0.1, y: 0.1, z: 1 }, { x: "0.1", y: 0.1 }]) {
      expect(addCommentSchema.safeParse({ assetId: id, body: "x", annotation }).success).toBe(false);
    }
    expect(addCommentSchema.safeParse({ assetId: id, body: "x", timestampSeconds: -1 }).success).toBe(false);
    expect(addCommentSchema.safeParse({ assetId: id, body: "x", timestampSeconds: Infinity }).success).toBe(false);
  });
  it("checks timestamps against the media duration when known", () => {
    expect(timestampError(10, 10.4)).toBeNull();
    expect(timestampError(11, 10)).toMatch(/past the end/);
    expect(timestampError(99, null)).toBeNull();
  });
});
