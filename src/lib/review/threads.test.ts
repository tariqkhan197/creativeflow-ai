import { describe, expect, it } from "vitest";
import {
  buildThreads,
  countThreads,
  isPoint,
  removeComment,
  snippet,
  timestampMs,
  upsertComment,
  type CommentRecord,
} from "./threads";

const c = (id: string, extra: Partial<CommentRecord> = {}): CommentRecord => ({
  id,
  asset_id: "a",
  parent_id: null,
  author_id: "u",
  body: id,
  timestamp_seconds: null,
  annotation: null,
  is_internal: false,
  resolved_at: null,
  resolved_by: null,
  edited_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  ...extra,
});

const records = [
  c("late", { timestamp_seconds: 30 }),
  c("early", { timestamp_seconds: 2 }),
  c("general"),
  c("done", { timestamp_seconds: 10, resolved_at: "2026-10-01T11:00:00Z" }),
  c("r2", { parent_id: "early", created_at: "2026-10-01T10:05:00Z" }),
  c("r1", { parent_id: "early", created_at: "2026-10-01T10:01:00Z" }),
];

describe("buildThreads", () => {
  it("orders threads by timestamp (general comments last) with replies by time", () => {
    const threads = buildThreads(records);
    expect(threads.map((t) => t.comment.id)).toEqual(["early", "done", "late", "general"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
  it("filters open and resolved threads", () => {
    expect(buildThreads(records, "open").map((t) => t.comment.id)).toEqual(["early", "late", "general"]);
    expect(buildThreads(records, "resolved").map((t) => t.comment.id)).toEqual(["done"]);
    expect(countThreads(records)).toEqual({ open: 3, resolved: 1, all: 4 });
  });
});

describe("upsertComment / removeComment", () => {
  it("keeps the newest version of a comment (dedupes realtime echoes)", () => {
    let map = new Map(records.map((r) => [r.id, r]));
    map = upsertComment(map, c("early", { body: "edited", updated_at: "2026-10-01T12:00:00Z", timestamp_seconds: 2 }));
    const stale = upsertComment(map, c("early", { body: "old", updated_at: "2026-10-01T10:00:00Z" }));
    expect(stale.get("early")!.body).toBe("edited");
    expect(stale).toBe(map);
  });
  it("removes a thread together with its replies", () => {
    const map = removeComment(new Map(records.map((r) => [r.id, r])), "early");
    expect([...map.keys()].sort()).toEqual(["done", "general", "late"]);
  });
});

describe("helpers", () => {
  it("recognises pins and shortens labels", () => {
    expect(isPoint({ x: 0.1, y: 0.2 })).toBe(true);
    expect(isPoint({ x: "1", y: 0 })).toBe(false);
    expect(isPoint(null)).toBe(false);
    expect(snippet("a  b\nc")).toBe("a b c");
    expect(snippet("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("timestampMs", () => {
  it("parses REST and Realtime timestamp formats identically", () => {
    expect(timestampMs("2026-10-02 11:02:18.636123+00")).toBe(timestampMs("2026-10-02T11:02:18.636+00:00"));
    expect(timestampMs("2026-10-02T11:02:18+05:30")).toBe(Date.parse("2026-10-02T05:32:18Z"));
    expect(timestampMs("garbage")).toBe(0);
  });
  it("orders updates across formats correctly", () => {
    let map = new Map([["x", c("x", { updated_at: "2026-10-02T11:02:18.636+00:00" })]]);
    map = upsertComment(map, c("x", { body: "newer", updated_at: "2026-10-02 11:02:19.000001+00" }));
    expect(map.get("x")!.body).toBe("newer");
  });
});
