import { describe, expect, it } from "vitest";
import { estimateFrameRate } from "./frame-rate";

const frames = (fps: number, n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i / fps);

describe("estimateFrameRate", () => {
  it.each([24, 25, 30, 60])("detects %i fps", (fps) => expect(estimateFrameRate(frames(fps, 12))).toBe(fps));
  it("snaps NTSC rates", () => {
    expect(estimateFrameRate(frames(30000 / 1001, 12))).toBe(29.97);
    expect(estimateFrameRate(frames(24000 / 1001, 12))).toBe(23.976);
  });
  it("tolerates a dropped frame", () => {
    const t = frames(25, 12);
    t.splice(5, 1);
    expect(estimateFrameRate(t)).toBe(25);
  });
  it("refuses to guess from too few or irregular samples", () => {
    expect(estimateFrameRate([0, 0.04, 0.08])).toBeUndefined();
    expect(estimateFrameRate([0, 0.01, 0.2, 0.21, 0.4, 0.5, 0.52])).toBeUndefined();
    expect(estimateFrameRate([])).toBeUndefined();
  });
});
