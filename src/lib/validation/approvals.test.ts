import { describe, expect, it } from "vitest";
import {
  approvalFiltersSchema,
  assetShareSchema,
  decideApprovalSchema,
  projectPortalSchema,
  requestApprovalSchema,
  revisionStatusSchema,
} from "./approvals";

const uuid = "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60";
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe("requestApprovalSchema", () => {
  it("trims the title and treats empty optional fields as absent", () => {
    expect(requestApprovalSchema.parse({ assetId: uuid, title: "  Cut v2 ", message: " ", dueDate: "" })).toEqual({
      assetId: uuid,
      title: "Cut v2",
    });
  });
  it("requires a title and a valid, non-past due date", () => {
    expect(requestApprovalSchema.safeParse({ assetId: uuid, title: "  " }).success).toBe(false);
    expect(requestApprovalSchema.safeParse({ assetId: uuid, title: "x".repeat(201) }).success).toBe(false);
    expect(requestApprovalSchema.safeParse({ assetId: uuid, title: "A", dueDate: "2000-01-01" }).success).toBe(false);
    expect(requestApprovalSchema.safeParse({ assetId: uuid, title: "A", dueDate: "31/12/2099" }).success).toBe(false);
    expect(requestApprovalSchema.parse({ assetId: uuid, title: "A", dueDate: tomorrow }).dueDate).toBe(tomorrow);
  });
  it("limits the message and requires a file id", () => {
    expect(requestApprovalSchema.safeParse({ assetId: uuid, title: "A", message: "x".repeat(5001) }).success).toBe(
      false,
    );
    expect(requestApprovalSchema.safeParse({ assetId: "nope", title: "A" }).success).toBe(false);
  });
});

describe("decideApprovalSchema", () => {
  it("accepts approve with or without a note", () => {
    expect(decideApprovalSchema.parse({ approvalId: uuid, decision: "approved" })).toEqual({
      approvalId: uuid,
      decision: "approved",
    });
  });
  it("requires a note when requesting changes", () => {
    const r = decideApprovalSchema.safeParse({ approvalId: uuid, decision: "changes_requested", note: "  " });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["note"]);
    expect(
      decideApprovalSchema.parse({ approvalId: uuid, decision: "changes_requested", note: " Brighter " }).note,
    ).toBe("Brighter");
  });
  it("rejects other decisions", () => {
    for (const decision of ["pending", "cancelled", "maybe"]) {
      expect(decideApprovalSchema.safeParse({ approvalId: uuid, decision }).success).toBe(false);
    }
  });
});

describe("projectPortalSchema", () => {
  it("reads checkboxes from form data", () => {
    expect(projectPortalSchema.parse({ projectId: uuid, clientVisible: "on" })).toEqual({
      projectId: uuid,
      clientVisible: true,
      allowClientDownloads: false,
    });
    expect(projectPortalSchema.parse({ projectId: uuid, allowClientDownloads: "on", clientSummary: " Hi " })).toEqual({
      projectId: uuid,
      clientVisible: false,
      allowClientDownloads: true,
      clientSummary: "Hi",
    });
  });
  it("limits the client summary", () => {
    expect(projectPortalSchema.safeParse({ projectId: uuid, clientSummary: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("small schemas", () => {
  it("validate ids, booleans and statuses", () => {
    expect(assetShareSchema.safeParse({ assetId: uuid, shared: "true" }).success).toBe(false);
    expect(assetShareSchema.safeParse({ assetId: uuid, shared: true }).success).toBe(true);
    expect(revisionStatusSchema.safeParse({ revisionId: uuid, status: "completed" }).success).toBe(true);
    expect(revisionStatusSchema.safeParse({ revisionId: uuid, status: "done" }).success).toBe(false);
  });
  it("falls back to pending for unknown filters", () => {
    expect(approvalFiltersSchema.parse({}).status).toBe("pending");
    expect(approvalFiltersSchema.parse({ status: "nope" }).status).toBe("pending");
    expect(approvalFiltersSchema.parse({ status: "all" }).status).toBe("all");
  });
});
