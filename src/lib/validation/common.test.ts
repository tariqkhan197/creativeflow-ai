import { describe, expect, it } from "vitest";
import { ilikeAny, parseMoneyToCents, parsePage } from "./common";

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

describe("ilikeAny", () => {
  it("builds a quoted, case-insensitive OR filter", () => {
    expect(ilikeAny(["name", "email"], " acme.com ")).toBe('name.ilike."%acme.com%",email.ilike."%acme.com%"');
  });
  it("drops characters that would break PostgREST quoting", () => {
    expect(ilikeAny(["name"], 'a"b\\c),name.eq.x')).toBe('name.ilike."%abc),name.eq.x%"');
  });
});
