"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addComment } from "@/lib/actions/comments";
import {
  buildThreads,
  countThreads,
  isPoint,
  reconcileComments,
  removeComment,
  snippet,
  upsertComment,
  type CommentFilter,
  type CommentRecord,
} from "@/lib/review/threads";
import { timestampError } from "@/lib/validation/comments";
import { CommentsPanel, type Person } from "./comments-panel";
import { ReviewViewer, type ViewerAsset } from "./review-viewer";
import { useLiveComments } from "./use-live-comments";
import type { PinPick, ReviewMarker, ReviewPin, ViewerHandle } from "./types";
import type { SignedMedia } from "./use-signed-media";

/**
 * Client shell for the review page: owns comments, playback position and
 * pin-placement state, and wires the comment panel to the player.
 */
export function ReviewWorkspace({
  asset,
  initialMedia,
  initialComments,
  people,
  currentUserId,
  canManage,
  side,
}: {
  asset: ViewerAsset;
  initialMedia: SignedMedia | null;
  initialComments: CommentRecord[];
  people: Person[];
  currentUserId: string;
  canManage: boolean;
  side: React.ReactNode;
}) {
  const viewer = useRef<ViewerHandle>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState(() => new Map(initialComments.map((c) => [c.id, c])));
  const [filter, setFilter] = useState<CommentFilter>("open");
  const [time, setTime] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [draftPin, setDraftPin] = useState<PinPick | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const onTime = useCallback((t: number) => setTime(t), []);

  const merge = useCallback((c: CommentRecord) => setComments((m) => upsertComment(m, c)), []);
  const remove = useCallback((id: string) => setComments((m) => removeComment(m, id)), []);
  const live = useLiveComments(asset.id, {
    onUpsert: merge,
    onDelete: remove,
    onResync: (rows) => setComments((m) => reconcileComments(m, rows)),
  });

  const topLevel = useMemo(() => [...comments.values()].filter((c) => c.parent_id === null), [comments]);
  const markers: ReviewMarker[] = useMemo(
    () =>
      topLevel
        .filter((c) => c.timestamp_seconds !== null)
        .map((c) => ({
          id: c.id,
          t: Number(c.timestamp_seconds),
          resolved: Boolean(c.resolved_at),
          label: snippet(c.body),
        })),
    [topLevel],
  );
  const pins: ReviewPin[] = useMemo(
    () =>
      topLevel
        .filter((c) => isPoint(c.annotation) && (filter === "all" || (filter === "open") === !c.resolved_at))
        .map((c) => {
          const p = c.annotation as { x: number; y: number };
          return {
            id: c.id,
            x: p.x,
            y: p.y,
            t: c.timestamp_seconds === null ? null : Number(c.timestamp_seconds),
            resolved: Boolean(c.resolved_at),
            label: snippet(c.body),
          };
        }),
    [topLevel, filter],
  );

  const focusComment = (id: string) => {
    setActiveId(id);
    document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const submit = async ({ body, withTime, isInternal }: { body: string; withTime: boolean; isInternal: boolean }) => {
    const seconds = withTime ? Math.round((viewer.current?.currentTime() ?? time) * 1000) / 1000 : null;
    const tsError = timestampError(seconds, asset.duration_seconds);
    if (tsError) {
      toast.error(tsError);
      return false;
    }
    const result = await addComment({
      assetId: asset.id,
      body,
      timestampSeconds: seconds,
      annotation: draftPin,
      isInternal,
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    merge(result.comment);
    setDraftPin(null);
    if (filter === "resolved") setFilter("open");
    return true;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <ReviewViewer
        ref={viewer}
        asset={asset}
        initialMedia={initialMedia}
        markers={markers}
        pins={pins}
        pickMode={pickMode}
        draftPin={draftPin}
        onPick={(p) => {
          setDraftPin(p);
          setPickMode(false);
          composer.current?.focus();
        }}
        onPinClick={(pin) => {
          if (pin.t !== null) viewer.current?.seek(pin.t);
          focusComment(pin.id);
        }}
        onTime={onTime}
        onRequestComment={() => composer.current?.focus()}
      />
      <aside className="grid content-start gap-4">
        <CommentsPanel
          ref={composer}
          kind={asset.kind}
          threads={buildThreads(comments.values(), filter)}
          counts={countThreads(comments.values())}
          filter={filter}
          onFilter={setFilter}
          people={people}
          currentUserId={currentUserId}
          canManage={canManage}
          activeId={activeId}
          live={live}
          currentTime={time}
          draftPin={draftPin}
          pickMode={pickMode}
          onTogglePick={() => {
            viewer.current?.pause();
            setPickMode((v) => !v);
          }}
          onClearPin={() => setDraftPin(null)}
          onSubmit={submit}
          onSeek={(t) => {
            viewer.current?.pause();
            viewer.current?.seek(t);
          }}
          onChange={merge}
          onRemove={remove}
        />
        {side}
      </aside>
    </div>
  );
}
