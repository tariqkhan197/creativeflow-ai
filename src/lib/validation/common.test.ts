import { describe, expect, it } from "vitest";
import { parseMoneyToCents, parsePage, toIlikePattern } from "./common";

describe("parseMoneyToCents", () => {
  it.each([
    ["2500", 250000],
    ["2,500", 250000],
    ["2,500.5", 250050],
    ["$ 1,234.56", 123456],
    ["0", 0],
    ["0.07", 7],
  ])("parses %s", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));

  it.each(["", "abc", "1.234", "-5", "1e5", "12.3.4"])("rejects %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe("parsePage", () => {
  it("defaults invalid values to page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(["2"])).toBe(1);
  });
  it("accepts positive integers", () => expect(parsePage("4")).toBe(4));
});

describe("toIlikePattern", () => {
  it("wraps the term and escapes LIKE wildcards", () => {
    expect(toIlikePattern(" acme ")).toBe("%acme%");
    expect(toIlikePattern("50%_off")).toBe("%50\\%\\_off%");
  });
  it("neutralises PostgREST filter syntax characters", () => {
    expect(toIlikePattern("a,b(c).d")).toBe("%a b c  d%");
  });
});
