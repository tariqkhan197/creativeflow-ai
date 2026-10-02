import type { ReviewComment } from "@/types/database";

export type CommentRecord = Pick<
  ReviewComment,
  | "id"
  | "asset_id"
  | "parent_id"
  | "author_id"
  | "body"
  | "timestamp_seconds"
  | "annotation"
  | "is_internal"
  | "resolved_at"
  | "resolved_by"
  | "edited_at"
  | "created_at"
  | "updated_at"
>;

export type CommentFilter = "open" | "resolved" | "all";

export type Thread = { comment: CommentRecord; replies: CommentRecord[] };

export const COMMENT_MAX_LENGTH = 5000;

const time = (c: CommentRecord) =>
  c.timestamp_seconds === null ? Number.POSITIVE_INFINITY : Number(c.timestamp_seconds);

/** Top-level comments with their replies, filtered and ordered by timestamp, then creation. */
export function buildThreads(records: Iterable<CommentRecord>, filter: CommentFilter = "all"): Thread[] {
  const all = [...records];
  const replies = new Map<string, CommentRecord[]>();
  for (const r of all) {
    if (r.parent_id) replies.set(r.parent_id, [...(replies.get(r.parent_id) ?? []), r]);
  }
  return all
    .filter((c) => c.parent_id === null)
    .filter((c) => (filter === "open" ? c.resolved_at === null : filter === "resolved" ? c.resolved_at !== null : true))
    .sort((a, b) => time(a) - time(b) || a.created_at.localeCompare(b.created_at))
    .map((comment) => ({
      comment,
      replies: (replies.get(comment.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
}

export function countThreads(records: Iterable<CommentRecord>) {
  const top = [...records].filter((c) => c.parent_id === null);
  return {
    open: top.filter((c) => !c.resolved_at).length,
    resolved: top.filter((c) => c.resolved_at).length,
    all: top.length,
  };
}

/**
 * Milliseconds for a Postgres timestamp in either REST ("2026-10-02T11:02:18.636+00:00")
 * or Realtime/text ("2026-10-02 11:02:18.636123+00") format.
 */
export function timestampMs(value: string): number {
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Insert or update a comment, keeping whichever version is newer (dedupes realtime echoes). */
export function upsertComment(map: Map<string, CommentRecord>, row: CommentRecord): Map<string, CommentRecord> {
  const existing = map.get(row.id);
  if (existing && timestampMs(existing.updated_at) > timestampMs(row.updated_at)) return map;
  const next = new Map(map);
  next.set(row.id, row);
  return next;
}

/** Remove a comment and, for a thread, its replies (mirrors the database cascade). */
export function removeComment(map: Map<string, CommentRecord>, id: string): Map<string, CommentRecord> {
  if (!map.has(id)) return map;
  const next = new Map(map);
  next.delete(id);
  for (const [key, c] of next) if (c.parent_id === id) next.delete(key);
  return next;
}

export function isPoint(a: unknown): a is { x: number; y: number } {
  return (
    typeof a === "object" &&
    a !== null &&
    typeof (a as { x: unknown }).x === "number" &&
    typeof (a as { y: unknown }).y === "number"
  );
}

export function isEdited(c: Pick<CommentRecord, "edited_at">): boolean {
  return c.edited_at !== null;
}

/** Short single-line label for markers and pins. */
export function snippet(body: string, max = 60): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Replace local state with the server's list (after a reconnect), keeping a
 * local row only if it is newer than the server's copy of it.
 */
export function reconcileComments(
  local: Map<string, CommentRecord>,
  server: CommentRecord[],
): Map<string, CommentRecord> {
  const next = new Map<string, CommentRecord>();
  for (const row of server) {
    const mine = local.get(row.id);
    next.set(row.id, mine && timestampMs(mine.updated_at) > timestampMs(row.updated_at) ? mine : row);
  }
  return next;
}

/** Realtime rows may carry numeric columns as strings; normalise to the REST shape. */
export function normalizeRealtimeComment(row: Record<string, unknown>): CommentRecord | null {
  if (typeof row.id !== "string" || typeof row.asset_id !== "string" || typeof row.body !== "string") return null;
  const ts = row.timestamp_seconds;
  return {
    id: row.id,
    asset_id: row.asset_id,
    parent_id: (row.parent_id as string | null) ?? null,
    author_id: (row.author_id as string | null) ?? null,
    body: row.body,
    timestamp_seconds: ts === null || ts === undefined ? null : Number(ts),
    annotation: (row.annotation as CommentRecord["annotation"]) ?? null,
    is_internal: Boolean(row.is_internal),
    resolved_at: (row.resolved_at as string | null) ?? null,
    resolved_by: (row.resolved_by as string | null) ?? null,
    edited_at: (row.edited_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
