"use client";

import { forwardRef, useState, useTransition } from "react";
import {
  CheckIcon,
  ClockIcon,
  CornerDownRightIcon,
  LockIcon,
  MapPinIcon,
  MessageSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/app/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteComment, editComment, replyToComment, setCommentResolved } from "@/lib/actions/comments";
import { formatPreciseTimecode, formatTimecode } from "@/lib/media/timecode";
import {
  COMMENT_MAX_LENGTH,
  isEdited,
  isPoint,
  type CommentFilter,
  type CommentRecord,
  type Thread,
} from "@/lib/review/threads";
import { cn, formatRelativeTime, initials } from "@/lib/utils";
import type { AssetKind } from "@/types/database";
import type { PinPick } from "./types";

export type Person = { id: string; name: string };

type PanelProps = {
  kind: AssetKind;
  threads: Thread[];
  counts: { open: number; resolved: number; all: number };
  filter: CommentFilter;
  onFilter: (f: CommentFilter) => void;
  people: Person[];
  currentUserId: string;
  canManage: boolean;
  activeId: string | null;
  // composer
  currentTime: number;
  draftPin: PinPick | null;
  pickMode: boolean;
  onTogglePick: () => void;
  onClearPin: () => void;
  onSubmit: (input: { body: string; withTime: boolean; isInternal: boolean }) => Promise<boolean>;
  onSeek: (t: number) => void;
  onChange: (comment: CommentRecord) => void;
  onRemove: (id: string) => void;
};

export const CommentsPanel = forwardRef<HTMLTextAreaElement, PanelProps>(function CommentsPanel(props, composerRef) {
  const { kind, threads, counts, filter, onFilter } = props;
  const timed = kind === "video" || kind === "audio";
  const pinnable = kind === "video" || kind === "image";
  const [body, setBody] = useState("");
  const [withTime, setWithTime] = useState(timed);
  const [isInternal, setIsInternal] = useState(false);
  const [pending, startTransition] = useTransition();
  const nameOf = (id: string | null) => props.people.find((p) => p.id === id)?.name ?? "Former member";

  const submit = () =>
    startTransition(async () => {
      if (await props.onSubmit({ body, withTime: timed && withTime, isInternal })) {
        setBody("");
        setIsInternal(false);
      }
    });

  return (
    <section aria-label="Comments" className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareIcon className="size-4" /> Comments
        </h2>
        <div className="flex gap-1 rounded-lg border p-0.5 text-xs" role="tablist" aria-label="Filter comments">
          {(["open", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => onFilter(f)}
              className={cn(
                "cursor-pointer rounded-md px-2 py-1 capitalize",
                filter === f ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f} <span className="tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={composerRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={COMMENT_MAX_LENGTH}
          rows={3}
          placeholder={timed ? "Comment at the current position… (C to focus)" : "Add a comment…"}
          aria-label="New comment"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {timed ? (
            <button
              type="button"
              onClick={() => setWithTime((v) => !v)}
              aria-pressed={withTime}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 font-mono",
                withTime ? "border-brand/40 bg-brand/10 text-brand" : "text-muted-foreground",
              )}
              title="Attach the current playback position"
            >
              <ClockIcon className="size-3" /> {withTime ? formatPreciseTimecode(props.currentTime) : "No time"}
            </button>
          ) : null}
          {pinnable ? (
            props.draftPin ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-warning">
                <MapPinIcon className="size-3" /> Pin placed
                <button type="button" onClick={props.onClearPin} aria-label="Remove pin" className="cursor-pointer">
                  <XIcon className="size-3" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={props.onTogglePick}
                aria-pressed={props.pickMode}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1",
                  props.pickMode ? "border-brand/40 bg-brand/10 text-brand" : "text-muted-foreground",
                )}
              >
                <MapPinIcon className="size-3" /> {props.pickMode ? "Click the frame…" : "Add pin"}
              </button>
            )
          ) : null}
          <label className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              className="accent-[var(--brand)]"
            />
            <LockIcon className="size-3" /> Internal note
          </label>
          <span className="ml-auto text-muted-foreground tabular-nums">
            {body.length > COMMENT_MAX_LENGTH - 500 ? `${body.length}/${COMMENT_MAX_LENGTH}` : null}
          </span>
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>

      {threads.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {filter === "resolved"
            ? "No resolved comments yet."
            : filter === "open"
              ? "No open comments."
              : "No comments yet."}
        </p>
      ) : (
        <ol className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
          {threads.map((t) => (
            <ThreadItem key={t.comment.id} thread={t} {...props} nameOf={nameOf} />
          ))}
        </ol>
      )}
    </section>
  );
});

function ThreadItem({
  thread,
  nameOf,
  currentUserId,
  canManage,
  activeId,
  onSeek,
  onChange,
  onRemove,
}: PanelProps & { thread: Thread; nameOf: (id: string | null) => string }) {
  const { comment, replies } = thread;
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const resolved = Boolean(comment.resolved_at);

  const toggleResolved = () =>
    startTransition(async () => {
      const r = await setCommentResolved({ commentId: comment.id, resolved: !resolved });
      if (!r.ok) toast.error(r.error);
      else onChange(r.comment);
    });

  const sendReply = () =>
    startTransition(async () => {
      const r = await replyToComment({ parentId: comment.id, body: reply, isInternal: false });
      if (!r.ok) toast.error(r.error);
      else {
        onChange(r.comment);
        setReply("");
        setReplying(false);
      }
    });

  return (
    <li
      id={`comment-${comment.id}`}
      className={cn(
        "grid gap-2 rounded-lg border p-3",
        resolved && "opacity-70",
        activeId === comment.id && "ring-2 ring-brand/50",
      )}
    >
      <CommentBody
        comment={comment}
        nameOf={nameOf}
        currentUserId={currentUserId}
        canManage={canManage}
        onSeek={onSeek}
        onChange={onChange}
        onRemove={onRemove}
      />
      {replies.length ? (
        <ol className="grid gap-2 border-l pl-3">
          {replies.map((r) => (
            <li key={r.id} id={`comment-${r.id}`}>
              <CommentBody
                comment={r}
                nameOf={nameOf}
                currentUserId={currentUserId}
                canManage={canManage}
                onSeek={onSeek}
                onChange={onChange}
                onRemove={onRemove}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendReply();
          }}
        >
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            maxLength={COMMENT_MAX_LENGTH}
            aria-label="Reply"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !reply.trim()}>
              Reply
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
            <CornerDownRightIcon /> Reply
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleResolved} disabled={pending}>
            {resolved ? <RotateCcwIcon /> : <CheckIcon />} {resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      )}
    </li>
  );
}

function CommentBody({
  comment,
  nameOf,
  currentUserId,
  canManage,
  onSeek,
  onChange,
  onRemove,
}: {
  comment: CommentRecord;
  nameOf: (id: string | null) => string;
  currentUserId: string;
  canManage: boolean;
  onSeek: (t: number) => void;
  onChange: (c: CommentRecord) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const [pending, startTransition] = useTransition();
  const mine = comment.author_id === currentUserId;
  const author = nameOf(comment.author_id);
  const t = comment.timestamp_seconds === null ? null : Number(comment.timestamp_seconds);

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">
          {initials(author)}
        </span>
        <span className="font-medium">{author}</span>
        <span className="text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
        {isEdited(comment) ? <span className="text-muted-foreground">(edited)</span> : null}
        {comment.is_internal ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <LockIcon className="size-2.5" /> Internal
          </Badge>
        ) : null}
        {comment.resolved_at ? (
          <Badge variant="success" className="text-[10px]">
            Resolved
          </Badge>
        ) : null}
        <div className="ml-auto flex">
          {mine && !editing ? (
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Edit comment">
              <PencilIcon />
            </Button>
          ) : null}
          {mine || canManage ? (
            <ConfirmAction
              title="Delete this comment?"
              description={
                comment.parent_id
                  ? "The reply is deleted permanently."
                  : "The comment and its replies are deleted permanently."
              }
              confirmLabel="Delete"
              action={async () => {
                const r = await deleteComment(comment.id);
                if (r.ok) onRemove(comment.id);
                return r;
              }}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="Delete comment">
                  <Trash2Icon />
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {t !== null ? (
          <button
            type="button"
            onClick={() => onSeek(t)}
            className="cursor-pointer rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[11px] text-warning hover:bg-warning/25"
            aria-label={`Jump to ${formatTimecode(t)}`}
          >
            {formatTimecode(t)}
          </button>
        ) : null}
        {isPoint(comment.annotation) ? <MapPinIcon className="size-3.5 text-brand" aria-label="Has a pin" /> : null}
      </div>
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await editComment({ commentId: comment.id, body: text });
              if (!r.ok) toast.error(r.error);
              else {
                onChange(r.comment);
                setEditing(false);
              }
            });
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={COMMENT_MAX_LENGTH}
            aria-label="Edit comment"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => (setEditing(false), setText(comment.body))}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !text.trim()}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
      )}
    </div>
  );
}
