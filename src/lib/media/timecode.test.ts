import { describe, expect, it } from "vitest";
import {
  formatFrameTimecode,
  formatPreciseTimecode,
  formatTimecode,
  markerPercent,
  parseTimecode,
  stepFrame,
} from "./timecode";

describe("timecode", () => {
  it("formats durations", () => {
    expect([
      formatTimecode(0),
      formatTimecode(83.9),
      formatTimecode(3725),
      formatTimecode(-1),
      formatTimecode(NaN),
    ]).toEqual(["0:00", "1:23", "1:02:05", "0:00", "0:00"]);
  });
  it("formats precise and frame timecodes", () => {
    expect(formatPreciseTimecode(83.45)).toBe("1:23.450");
    expect(formatPreciseTimecode(1.9996)).toBe("0:02.000");
    expect(formatFrameTimecode(1.5, 24)).toBe("00:00:01:12");
    expect(formatFrameTimecode(3661 + 2 / 25, 25)).toBe("01:01:01:02");
  });
  it("parses timecodes and rejects invalid ones", () => {
    expect([parseTimecode("83"), parseTimecode("1:23"), parseTimecode("1:02:05"), parseTimecode("1:23.5")]).toEqual([
      83, 83, 3725, 83.5,
    ]);
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "1.2.3"]) expect(parseTimecode(bad)).toBeNull();
  });
  it("steps frames within bounds", () => {
    expect(stepFrame(1, 1, 25)).toBe(1.04);
    expect(stepFrame(0, -1, 25)).toBe(0);
    expect(stepFrame(9.99, 1, 25, 10)).toBe(10);
    expect(stepFrame(1, 1, null)).toBe(1.033);
  });
  it("positions markers", () => {
    expect(markerPercent(5, 20)).toBe(25);
    expect(markerPercent(30, 20)).toBe(100);
    expect(markerPercent(5, null)).toBeNull();
  });
});
