// Test seam for tests/browser: in-memory stand-ins for the comment Server
// Actions (which need Next.js + Supabase). They return rows shaped like the
// database's, so the review UI's state handling runs in a plain browser. The
// real authorization/validation rules are covered by scripts/test-db.mjs and
// verify-supabase --e2e.
import type { CommentRecord } from "@/lib/review/threads";

type Result = { ok: true; comment: CommentRecord } | { ok: false; error: string };
type W = Window & { __comments?: Map<string, CommentRecord>; __me?: string };
const w = window as W;
const store = () => (w.__comments ??= new Map());
const now = () => new Date().toISOString();

export async function addComment(input: {
  assetId: string;
  body: string;
  timestampSeconds: number | null;
  annotation: { x: number; y: number } | null;
  isInternal: boolean;
}): Promise<Result> {
  if (!input.body.trim()) return { ok: false, error: "Write a comment first" };
  const c: CommentRecord = {
    id: crypto.randomUUID(),
    asset_id: input.assetId,
    parent_id: null,
    author_id: w.__me ?? "me",
    body: input.body.trim(),
    timestamp_seconds: input.timestampSeconds,
    annotation: input.annotation,
    is_internal: input.isInternal,
    resolved_at: null,
    resolved_by: null,
    edited_at: null,
    created_at: now(),
    updated_at: now(),
  };
  store().set(c.id, c);
  return { ok: true, comment: c };
}

export async function replyToComment(input: { parentId: string; body: string; isInternal: boolean }): Promise<Result> {
  const parent = store().get(input.parentId);
  if (!parent) return { ok: false, error: "This comment no longer exists." };
  const c: CommentRecord = {
    ...parent,
    id: crypto.randomUUID(),
    parent_id: parent.id,
    author_id: w.__me ?? "me",
    body: input.body.trim(),
    timestamp_seconds: null,
    annotation: null,
    is_internal: parent.is_internal || input.isInternal,
    resolved_at: null,
    created_at: now(),
    updated_at: now(),
  };
  store().set(c.id, c);
  return { ok: true, comment: c };
}

export async function editComment(input: { commentId: string; body: string }): Promise<Result> {
  const c = store().get(input.commentId);
  if (!c) return { ok: false, error: "missing" };
  const next = { ...c, body: input.body.trim(), edited_at: now(), updated_at: now() };
  store().set(c.id, next);
  return { ok: true, comment: next };
}

export async function setCommentResolved(input: { commentId: string; resolved: boolean }): Promise<Result> {
  const c = store().get(input.commentId);
  if (!c) return { ok: false, error: "missing" };
  const next = {
    ...c,
    resolved_at: input.resolved ? now() : null,
    resolved_by: input.resolved ? "me" : null,
    updated_at: now(),
  };
  store().set(c.id, next);
  return { ok: true, comment: next };
}

export async function deleteComment(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  store().delete(id);
  return { ok: true };
}

export async function listComments(assetId: string) {
  return { ok: true as const, comments: [...store().values()].filter((c) => c.asset_id === assetId) };
}
