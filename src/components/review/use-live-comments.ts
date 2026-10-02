"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { listComments } from "@/lib/actions/comments";
import { normalizeRealtimeComment, type CommentRecord } from "@/lib/review/threads";
import { createClient } from "@/lib/supabase/client";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Subscribes to comment changes for one asset via Supabase Realtime.
 *
 * - The socket is authenticated with the signed-in user's own token, so
 *   Realtime applies the review_comments RLS policy per subscriber: people
 *   only receive comments they could read (clients never get internal notes).
 * - Events are merged through the same "newer wins" rule as action results,
 *   so echoes of our own writes are de-duplicated.
 * - After a reconnect, the list is re-fetched to catch events missed offline.
 * - DELETE events carry only the id (Realtime can't filter or RLS-check
 *   deletes); unknown ids are simply ignored.
 */
export function useLiveComments(
  assetId: string,
  handlers: {
    onUpsert: (c: CommentRecord) => void;
    onDelete: (id: string) => void;
    onResync: (rows: CommentRecord[]) => void;
  },
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let wasLive = false;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channel = supabase
        // `wait: true`: report SUBSCRIBED only once the server confirms the
        // postgres_changes subscription is active. Without it, SUBSCRIBED can
        // arrive before the replication stream is live and early comments are
        // silently missed while the UI already says "Live".
        .channel(`review-comments:${assetId}`, { config: { postgres_changes_options: { wait: true } } })
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "review_comments", filter: `asset_id=eq.${assetId}` },
          (payload) => {
            const row = normalizeRealtimeComment(payload.new as Record<string, unknown>);
            if (row) latest.current.onUpsert(row);
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "review_comments", filter: `asset_id=eq.${assetId}` },
          (payload) => {
            const row = normalizeRealtimeComment(payload.new as Record<string, unknown>);
            if (row) latest.current.onUpsert(row);
          },
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "review_comments" }, (payload) => {
          const id = (payload.old as { id?: unknown }).id;
          if (typeof id === "string") latest.current.onDelete(id);
        })
        .subscribe((state, err) => {
          if (state === "SUBSCRIBED") {
            setStatus("live");
            if (wasLive) {
              void listComments(assetId).then((r) => {
                if (r.ok) latest.current.onResync(r.comments);
              });
            }
            wasLive = true;
          } else if (
            state === "CHANNEL_ERROR" &&
            /RealtimeDisabledForConfiguration/i.test(`${err?.message ?? ""} ${JSON.stringify(err?.cause ?? "")}`)
          ) {
            // review_comments isn't in the supabase_realtime publication; retrying won't help.
            console.error("Realtime is not enabled for review_comments on this Supabase project.", err);
            setStatus("offline");
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
            setStatus("reconnecting");
          } else if (state === "CLOSED") {
            setStatus("offline");
          }
        });
    })();

    // Keep the socket's token fresh across long sessions.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [assetId]);

  return status;
}
