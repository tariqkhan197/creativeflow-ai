import { describe, expect, it } from "vitest";
import {
  canInvite,
  canLeave,
  canManageMember,
  canManagePortalAccess,
  canViewSetup,
  canManageWork,
  grantableRoles,
  isStaff,
} from "./permissions";

const owner = { userId: "o", role: "owner" as const };
const admin = { userId: "a", role: "admin" as const };
const admin2 = { userId: "a2", role: "admin" as const };
const manager = { userId: "m", role: "manager" as const };
const member = { userId: "u", role: "member" as const };

describe("role capabilities", () => {
  it("matches the database rules", () => {
    expect(["owner", "admin"].map((r) => canInvite(r as never))).toEqual([true, true]);
    expect(["manager", "member", "client"].map((r) => canInvite(r as never))).toEqual([false, false, false]);
    expect(canManageWork("manager")).toBe(true);
    expect(canManageWork("member")).toBe(false);
    expect(isStaff("member")).toBe(true);
    expect(isStaff("client")).toBe(false);
    expect(canLeave("owner")).toBe(false);
    expect(canLeave("admin")).toBe(true);
  });

  it("only the owner can grant admin", () => {
    expect(grantableRoles("owner")).toEqual(["admin", "manager", "member"]);
    expect(grantableRoles("admin")).toEqual(["manager", "member"]);
    expect(grantableRoles("manager")).toEqual([]);
  });
});

describe("canManageMember", () => {
  it("nobody manages the owner, and nobody manages themselves", () => {
    expect(canManageMember(admin, owner)).toBe(false);
    expect(canManageMember(owner, owner)).toBe(false);
    expect(canManageMember(manager, manager)).toBe(false);
  });
  it("the owner manages everyone else", () => {
    expect([admin, manager, member].every((t) => canManageMember(owner, t))).toBe(true);
  });
  it("admins manage non-admins only", () => {
    expect(canManageMember(admin, manager)).toBe(true);
    expect(canManageMember(admin, member)).toBe(true);
    expect(canManageMember(admin, admin2)).toBe(false);
  });
  it("managers and members manage nobody", () => {
    expect(canManageMember(manager, member)).toBe(false);
    expect(canManageMember(member, manager)).toBe(false);
  });
});

describe("canManagePortalAccess", () => {
  it("allows owners, admins and managers only", () => {
    expect(canManagePortalAccess("owner")).toBe(true);
    expect(canManagePortalAccess("admin")).toBe(true);
    expect(canManagePortalAccess("manager")).toBe(true);
    expect(canManagePortalAccess("member")).toBe(false);
    expect(canManagePortalAccess("client")).toBe(false);
  });
});

describe("canViewSetup", () => {
  it("allows only owners and admins once Supabase is connected", () => {
    expect(["owner", "admin"].map((r) => canViewSetup(r as never))).toEqual([true, true]);
    expect(["manager", "member", "client"].map((r) => canViewSetup(r as never))).toEqual([false, false, false]);
  });
});
