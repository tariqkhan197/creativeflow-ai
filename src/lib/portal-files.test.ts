import { describe, expect, it } from "vitest";
import { groupPortalFiles } from "./portal-files";

const row = (id: string, version: number, root: string | null, created: string) => ({
  id,
  name: `${id}.mp4`,
  kind: "video",
  version_number: version,
  root_asset_id: root,
  created_at: created,
});

describe("groupPortalFiles", () => {
  it("groups shared versions by original, newest first", () => {
    const groups = groupPortalFiles([
      row("a1", 1, null, "2026-01-01T00:00:00Z"),
      row("a3", 3, "a1", "2026-01-03T00:00:00Z"),
      row("b1", 1, null, "2026-01-02T00:00:00Z"),
    ]);
    expect(groups.map((g) => [g.rootId, g.latest.id, g.versions.map((v) => v.id)])).toEqual([
      ["a1", "a3", ["a3", "a1"]],
      ["b1", "b1", ["b1"]],
    ]);
  });
  it("handles a shared later version whose original isn't shared", () => {
    const groups = groupPortalFiles([row("a2", 2, "a1", "2026-01-02T00:00:00Z")]);
    expect(groups).toEqual([
      {
        rootId: "a1",
        latest: expect.objectContaining({ id: "a2" }),
        versions: [expect.objectContaining({ id: "a2" })],
      },
    ]);
  });
  it("returns nothing for no rows", () => {
    expect(groupPortalFiles([])).toEqual([]);
  });
});
