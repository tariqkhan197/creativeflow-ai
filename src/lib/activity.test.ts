import { describe, expect, it } from "vitest";
import { activityHref, describeActivity, referencedUserIds } from "./activity";

const nameOf = (id: string | null) => (id === "u2" ? "Erin" : "Someone");
const e = (
  action: string,
  metadata: Record<string, string> = {},
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
    expect(describeActivity(e("asset.uploaded"), nameOf)).toBe("asset uploaded");
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
