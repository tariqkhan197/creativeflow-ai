import { describe, expect, it } from "vitest";
import { activityHref, describeActivity, referencedUserIds } from "./activity";

const nameOf = (id: string | null) => (id === "u2" ? "Erin" : "Someone");
const e = (
  action: string,
  metadata: Record<string, string | number | boolean> = {},
  entity_type = "project",
  entity_id: string | null = "p1",
) => ({
  action,
  metadata,
  entity_type,
  entity_id,
});

describe("describeActivity", () => {
  it("describes Phase 2 events with their details", () => {
    expect(describeActivity(e("project.created", { name: "Spring film" }), nameOf)).toBe(
      "created project “Spring film”",
    );
    expect(
      describeActivity(e("project.status_changed", { name: "X", from: "planning", to: "in_review" }), nameOf),
    ).toBe("moved “X” from Planning to In review");
    expect(describeActivity(e("member.role_changed", { from: "member", to: "manager" }, "member", "u2"), nameOf)).toBe(
      "changed Erin's role from Member to Manager",
    );
    expect(describeActivity(e("invitation.created", { email: "a@b.co", role: "admin" }, "invitation"), nameOf)).toBe(
      "invited a@b.co as Admin",
    );
    expect(describeActivity(e("task.completed", { title: "Edit" }, "task"), nameOf)).toBe("completed task “Edit”");
  });
  it("falls back gracefully for unknown actions or malformed metadata", () => {
    expect(describeActivity(e("invoice.sent"), nameOf)).toBe("invoice sent");
    expect(describeActivity({ ...e("client.created"), metadata: null }, nameOf)).toBe("added client");
  });
});

describe("activityHref", () => {
  it("links to existing entities only", () => {
    expect(activityHref(e("project.created"))).toBe("/app/projects/p1");
    expect(activityHref(e("project.deleted"))).toBeNull();
    expect(activityHref(e("task.created", { project_id: "p9" }, "task", "t1"))).toBe("/app/projects/p9");
    expect(activityHref(e("client.created", {}, "client", "c1"))).toBe("/app/clients/c1");
    expect(activityHref(e("workspace.created", {}, "workspace", "w1"))).toBeNull();
  });
});

describe("referencedUserIds", () => {
  it("collects actors and member targets without duplicates", () => {
    expect(
      referencedUserIds([
        { ...e("member.removed", {}, "member", "u2"), actor_id: "u1" },
        { ...e("project.created"), actor_id: "u1" },
      ]).sort(),
    ).toEqual(["u1", "u2"]);
  });
});

describe("Phase 3 activity", () => {
  it("describes uploads, versions, deletions and comments", () => {
    expect(describeActivity(e("asset.uploaded", { name: "Cut.mp4" }, "asset"), nameOf)).toBe("uploaded “Cut.mp4”");
    expect(describeActivity(e("asset.version_added", { name: "Cut.mp4", version: 3 }, "asset"), nameOf)).toBe(
      "added version 3 of “Cut.mp4”",
    );
    expect(describeActivity(e("asset.deleted", { name: "Cut.mp4", version: 2 }, "asset"), nameOf)).toBe(
      "deleted version 2 of “Cut.mp4”",
    );
    expect(describeActivity(e("asset.deleted", { name: "Cut.mp4", version: 1 }, "asset"), nameOf)).toBe(
      "deleted “Cut.mp4”",
    );
    expect(describeActivity(e("comment.created", { internal: true }, "comment"), nameOf)).toBe(
      "added an internal note",
    );
    expect(describeActivity(e("comment.created", { reply: true }, "comment"), nameOf)).toBe("replied to a comment");
    expect(describeActivity(e("comment.resolved", {}, "comment"), nameOf)).toBe("resolved a comment");
  });
  it("links to the asset review page and comment", () => {
    expect(activityHref(e("asset.uploaded", { project_id: "p" }, "asset", "a1"))).toBe("/app/projects/p/assets/a1");
    expect(activityHref(e("asset.deleted", { project_id: "p" }, "asset", "a1"))).toBeNull();
    expect(activityHref(e("comment.created", { project_id: "p", asset_id: "a2" }, "comment", "c1"))).toBe(
      "/app/projects/p/assets/a2#comment-c1",
    );
  });
});
