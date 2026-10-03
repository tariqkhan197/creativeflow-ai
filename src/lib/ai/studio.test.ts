import { describe, expect, it } from "vitest";
import {
  AI_LIMITS,
  briefDefaultsFrom,
  formatSeconds,
  isStalePending,
  normalizeEditedScript,
  readScript,
  usageWindowStarts,
} from "./studio";
import { validScript } from "./test-fixtures";

describe("AI Studio helpers", () => {
  it("mirror the database limits", () => {
    expect(AI_LIMITS).toEqual({ workspacePerDay: 50, userPerHour: 20, staleAfterMinutes: 15 });
  });

  it("read only valid stored scripts", () => {
    expect(readScript(validScript)).toEqual(validScript);
    expect(readScript({ scenes: [] })).toBeNull();
    expect(readScript(null)).toBeNull();
  });

  it("recalculate the total length of an edited script", () => {
    const edited = { ...validScript, totalSeconds: 999, scenes: [{ ...validScript.scenes[0], seconds: 12 }] };
    expect(normalizeEditedScript(edited)).toEqual({ ok: true, script: { ...edited, totalSeconds: 12 } });
  });

  it("explain what's wrong with an edited script", () => {
    const bad = normalizeEditedScript({
      ...validScript,
      scenes: [{ ...validScript.scenes[0], heading: "", seconds: 0 }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.errors.some((e) => e.startsWith("Scene 1 (heading)"))).toBe(true);
    expect(normalizeEditedScript({ ...validScript, scenes: [] })).toMatchObject({ ok: false });
    const tooLong = normalizeEditedScript({
      ...validScript,
      scenes: [
        { ...validScript.scenes[0], seconds: 600 },
        { ...validScript.scenes[1], seconds: 600 },
      ],
    });
    expect(tooLong.ok === false && tooLong.errors.join()).toMatch(/Total length/);
    expect(normalizeEditedScript("nope")).toMatchObject({ ok: false });
  });

  it("prefill the brief from an earlier generation, tolerating old or odd input", () => {
    expect(
      briefDefaultsFrom({
        title: "First Mile",
        project_id: "p1",
        input: { brief: "Launch film", durationSeconds: 45, tone: "Warm", audience: null },
      }),
    ).toEqual({
      title: "First Mile",
      projectId: "p1",
      brief: "Launch film",
      durationSeconds: "45",
      audience: "",
      tone: "Warm",
      platform: "",
      callToAction: "",
    });
    expect(briefDefaultsFrom({ title: null, project_id: null, input: [] }).durationSeconds).toBe("30");
  });

  it("detect runs stuck past the timeout", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    expect(isStalePending("pending", "2026-10-03T11:44:00Z", now)).toBe(true);
    expect(isStalePending("pending", "2026-10-03T11:50:00Z", now)).toBe(false);
    expect(isStalePending("failed", "2026-10-03T10:00:00Z", now)).toBe(false);
  });

  it("format lengths", () => {
    expect(formatSeconds(30)).toBe("30s");
    expect(formatSeconds(95)).toBe("1:35");
  });
});

describe("usageWindowStarts", () => {
  it("returns the 24-hour and 1-hour windows the limits count over", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(usageWindowStarts(now)).toEqual({
      day: "2026-10-02T12:00:00.000Z",
      hour: "2026-10-03T11:00:00.000Z",
    });
  });
});
