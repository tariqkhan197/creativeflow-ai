import { describe, expect, it } from "vitest";
import { clientSchema } from "./clients";
import { projectFiltersSchema, projectSchema } from "./projects";
import { taskSchema } from "./tasks";
import { changeRoleSchema, invitationTokenSchema, inviteMemberSchema } from "./team";

const uuid = "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60";

describe("inviteMemberSchema", () => {
  it("normalises the email and accepts staff roles", () => {
    expect(inviteMemberSchema.parse({ email: " Jo@Agency.COM ", role: "manager" })).toEqual({
      email: "jo@agency.com",
      role: "manager",
    });
  });
  it("rejects owner and client roles", () => {
    expect(inviteMemberSchema.safeParse({ email: "jo@agency.com", role: "owner" }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: "jo@agency.com", role: "client" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ userId: uuid, role: "owner" }).success).toBe(false);
  });
  it("rejects invalid emails", () => {
    expect(inviteMemberSchema.safeParse({ email: "nope", role: "member" }).success).toBe(false);
  });
});

describe("invitationTokenSchema", () => {
  it("accepts a 43-char base64url token only", () => {
    expect(invitationTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(invitationTokenSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(invitationTokenSchema.safeParse(`${"a".repeat(42)}/`).success).toBe(false);
  });
});

describe("clientSchema", () => {
  it("turns empty optional fields into undefined", () => {
    expect(clientSchema.parse({ name: "Acme", company: "", email: "", phone: "", notes: "" })).toEqual({
      name: "Acme",
    });
  });
  it("validates email and phone", () => {
    expect(clientSchema.safeParse({ name: "Acme", email: "bad" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "Acme", phone: "call me" }).success).toBe(false);
    expect(clientSchema.parse({ name: "Acme", phone: "+1 (555) 010-2000" }).phone).toBe("+1 (555) 010-2000");
  });
  it("requires a name", () => expect(clientSchema.safeParse({ name: "  " }).success).toBe(false));
});

describe("projectSchema", () => {
  const base = { name: "Launch film", currency: "usd" };
  it("applies defaults and converts the budget to cents", () => {
    expect(projectSchema.parse({ ...base, budget: "12,500.50", clientId: "" })).toMatchObject({
      status: "planning",
      priority: "medium",
      currency: "USD",
      budget: 1250050,
      clientId: undefined,
    });
  });
  it("rejects a due date before the start date", () => {
    const r = projectSchema.safeParse({ ...base, startDate: "2026-10-10", dueDate: "2026-10-01" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["dueDate"]);
  });
  it("rejects invalid budgets, dates and statuses", () => {
    expect(projectSchema.safeParse({ ...base, budget: "lots" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, dueDate: "2026-13-45" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, status: "done" }).success).toBe(false);
  });
});

describe("projectFiltersSchema", () => {
  it("drops unknown filter values instead of failing", () => {
    expect(projectFiltersSchema.parse({ status: "bogus", client: "x", view: "weird", q: "  spring " })).toEqual({
      q: "spring",
      status: undefined,
      client: undefined,
      view: "active",
    });
  });
});

describe("taskSchema", () => {
  it("parses a minimal task", () => {
    expect(taskSchema.parse({ projectId: uuid, title: " Edit ", assigneeId: "", dueDate: "" })).toEqual({
      projectId: uuid,
      title: "Edit",
      status: "todo",
      assigneeId: undefined,
      dueDate: undefined,
      description: undefined,
    });
  });
  it("rejects an empty title or invalid assignee", () => {
    expect(taskSchema.safeParse({ projectId: uuid, title: "" }).success).toBe(false);
    expect(taskSchema.safeParse({ projectId: uuid, title: "x", assigneeId: "bob" }).success).toBe(false);
  });
});
