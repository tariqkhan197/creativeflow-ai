import { describe, expect, it } from "vitest";
import { dbErrorMessage } from "./db-errors";

describe("dbErrorMessage", () => {
  it("shows messages raised by our own database rules", () => {
    expect(dbErrorMessage({ code: "P0001", message: "Only the workspace owner can remove an admin." }, "x")).toBe(
      "Only the workspace owner can remove an admin.",
    );
    expect(
      dbErrorMessage({ code: "23514", message: "The assignee must be a team member of this workspace" }, "x"),
    ).toBe("The assignee must be a team member of this workspace");
  });
  it("hides internal constraint and policy details", () => {
    expect(
      dbErrorMessage({ code: "23514", message: 'new row violates check constraint "projects_check"' }, "Fallback"),
    ).toBe("Fallback");
    expect(
      dbErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "x"' }, "F"),
    ).toBe("You don't have permission to do that.");
    expect(dbErrorMessage({ code: "XX000", message: "internal" }, "Fallback")).toBe("Fallback");
    expect(dbErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
