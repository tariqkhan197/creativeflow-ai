import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./routes";

const ORIGIN = "https://app.example.com";
/** Where a browser would actually go if we redirected to the returned value. */
const destination = (path: string) => new URL(path, ORIGIN);

describe("safeRedirectPath", () => {
  it("keeps same-origin paths, with query and hash", () => {
    expect(safeRedirectPath("/app")).toBe("/app");
    expect(safeRedirectPath("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
    expect(safeRedirectPath("/app/projects?new=1&client=x#files")).toBe("/app/projects?new=1&client=x#files");
    expect(safeRedirectPath("/portal/projects/p1/files/a1")).toBe("/portal/projects/p1/files/a1");
  });

  it("normalises dot segments without leaving the site", () => {
    expect(safeRedirectPath("/app/../portal")).toBe("/portal");
    expect(safeRedirectPath("/../../etc")).toBe("/etc");
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["backslash later in the path", "/app\\..\\..\\evil.example"],
    ["tab (stripped by URL parsers)", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["NUL", "/\u0000/evil.example"],
    ["DEL", "/\u007f/evil.example"],
    ["absolute URL", "https://evil.example/app"],
    ["javascript: URL", "javascript:alert(1)"],
    ["relative path", "app"],
    ["empty string", ""],
    ["overlong value", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBe("/app");
    expect(safeRedirectPath(value, "")).toBe("");
  });

  it("rejects non-strings", () => {
    expect(safeRedirectPath(null)).toBe("/app");
    expect(safeRedirectPath(undefined, "/onboarding")).toBe("/onboarding");
    expect(safeRedirectPath(["/app"])).toBe("/app");
  });

  it("never yields a path that resolves to another origin (regression: tab trick)", () => {
    const attacks = [
      "/\t/evil.example",
      "/\n\n/evil.example",
      "/\t\\evil.example",
      "/%09/evil.example",
      "/%2F/evil.example",
    ];
    for (const attack of attacks) {
      expect(destination(safeRedirectPath(attack)).origin).toBe(ORIGIN);
    }
  });
});
