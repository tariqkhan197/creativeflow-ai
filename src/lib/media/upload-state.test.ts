import { describe, expect, it } from "vitest";
import { canTransition, InvalidUploadTransition, progressPercent, transition, type UploadItem } from "./upload-state";

const base: UploadItem = { key: "k", fileName: "a.mp4", size: 1000, phase: "queued", bytesSent: 0 };

function run(...events: Parameters<typeof transition>[1][]) {
  return events.reduce(transition, base);
}

describe("upload state machine", () => {
  it("follows the happy path", () => {
    const done = run(
      { type: "start" },
      { type: "created", assetId: "a1" },
      { type: "progress", bytesSent: 400 },
      { type: "pause" },
      { type: "resume" },
      { type: "progress", bytesSent: 1000 },
      { type: "uploaded" },
      { type: "finalized" },
    );
    expect(done).toMatchObject({ phase: "done", assetId: "a1", bytesSent: 1000 });
  });

  it("retries on the same asset record after a retryable failure", () => {
    const failed = run(
      { type: "start" },
      { type: "created", assetId: "a1" },
      { type: "fail", error: "network", retryable: true },
    );
    const retried = transition(failed, { type: "retry" });
    expect(retried).toMatchObject({ phase: "creating", assetId: "a1", error: undefined, bytesSent: 0 });
  });

  it("does not retry validation failures", () => {
    const failed = run({ type: "start" }, { type: "fail", error: "too big", retryable: false });
    expect(canTransition(failed, { type: "retry" })).toBe(false);
  });

  it("can cancel any non-terminal upload, but not finished ones", () => {
    expect(run({ type: "cancel" }).phase).toBe("cancelled");
    expect(run({ type: "start" }, { type: "created", assetId: "a" }, { type: "pause" }, { type: "cancel" }).phase).toBe(
      "cancelled",
    );
    const done = run({ type: "start" }, { type: "created", assetId: "a" }, { type: "uploaded" }, { type: "finalized" });
    expect(canTransition(done, { type: "cancel" })).toBe(false);
  });

  it("rejects impossible transitions", () => {
    expect(() => transition(base, { type: "uploaded" })).toThrow(InvalidUploadTransition);
    expect(() => run({ type: "start" }, { type: "pause" })).toThrow(InvalidUploadTransition);
    expect(() => run({ type: "start" }, { type: "created", assetId: "a" }, { type: "finalized" })).toThrow();
    expect(() => transition(base, { type: "fail", error: "x", retryable: true })).toThrow();
  });

  it("clamps progress to the file size", () => {
    const up = run({ type: "start" }, { type: "created", assetId: "a" }, { type: "progress", bytesSent: 5000 });
    expect(up.bytesSent).toBe(1000);
    expect(progressPercent({ bytesSent: 333, size: 1000 })).toBe(33);
    expect(progressPercent({ bytesSent: 0, size: 0 })).toBe(0);
  });
});
