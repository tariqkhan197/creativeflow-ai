import { describe, expect, it } from "vitest";
import { containedRect, fromNormalizedPoint, isPinVisible, toNormalizedPoint } from "./geometry";

describe("containedRect", () => {
  it("letterboxes wide media in a tall box", () => {
    expect(containedRect(1000, 1000, 1920, 1080)).toEqual({ x: 0, y: 218.75, width: 1000, height: 562.5 });
  });
  it("pillarboxes tall media", () => {
    expect(containedRect(1600, 900, 1080, 1920)).toMatchObject({ y: 0, height: 900, width: 506.25 });
  });
  it("uses the whole box when media size is unknown", () => {
    expect(containedRect(800, 450)).toEqual({ x: 0, y: 0, width: 800, height: 450 });
  });
});

describe("normalized points", () => {
  const frame = { x: 0, y: 218.75, width: 1000, height: 562.5 };
  it("round-trips a click", () => {
    const p = toNormalizedPoint(250, 218.75 + 281.25, frame)!;
    expect(p).toEqual({ x: 0.25, y: 0.5 });
    expect(fromNormalizedPoint(p, frame)).toEqual({ left: 250, top: 500 });
  });
  it("ignores clicks on the letterbox bars", () => {
    expect(toNormalizedPoint(500, 100, frame)).toBeNull();
    expect(toNormalizedPoint(500, 900, frame)).toBeNull();
  });
});

describe("isPinVisible", () => {
  it("shows video pins near their timestamp and image pins always", () => {
    expect(isPinVisible(10, 10.3)).toBe(true);
    expect(isPinVisible(10, 11)).toBe(false);
    expect(isPinVisible(null, 99)).toBe(true);
  });
});
