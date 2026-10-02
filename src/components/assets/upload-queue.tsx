"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  cancelAssetUpload,
  createAssetUpload,
  finalizeAssetUpload,
  markAssetUploadFailed,
  retryAssetUpload,
  type UploadTarget,
} from "@/lib/actions/assets";
import { getSupabasePublicConfig } from "@/lib/env/public";
import { checkFileSize, resolveFileType } from "@/lib/media/file-types";
import { probeMedia, type MediaProbe } from "@/lib/media/probe";
import { createResumableUpload, type ResumableUpload } from "@/lib/media/resumable-upload";
import { canTransition, isActive, transition, type UploadEvent, type UploadItem } from "@/lib/media/upload-state";
import { createClient } from "@/lib/supabase/client";

export type QueueItem = UploadItem & { file: File; rootAssetId?: string; label?: string };

type EnqueueOptions = { rootAssetId?: string; resumeAssetId?: string; label?: string };

type UploadQueueValue = {
  items: QueueItem[];
  limitBytes: number | null;
  enqueue: (files: File[], options?: EnqueueOptions) => void;
  pause: (key: string) => void;
  resume: (key: string) => void;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  clearFinished: () => void;
};

const UploadQueueContext = createContext<UploadQueueValue | null>(null);

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueue must be used inside <UploadQueueProvider>");
  return ctx;
}

const MAX_PARALLEL = 2;

export function UploadQueueProvider({
  projectId,
  limitBytes,
  children,
}: {
  projectId: string;
  limitBytes: number | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef(items);
  const controllers = useRef(new Map<string, ResumableUpload>());
  const started = useRef(new Set<string>());
  const supabase = useMemo(() => createClient(), []);
  const { key: publishableKey } = getSupabasePublicConfig();

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const update = useCallback((key: string, event: UploadEvent, patch?: Partial<QueueItem>) => {
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key || !canTransition(it, event)) return it;
        return { ...it, ...(transition(it, event) as QueueItem), ...patch };
      }),
    );
  }, []);

  const get = (key: string) => itemsRef.current.find((i) => i.key === key);

  const finish = useCallback(
    async (key: string, target: UploadTarget, probe: MediaProbe) => {
      update(key, { type: "uploaded" });
      const notes = [...probe.notes];
      if (!probe.previewable)
        notes.unshift("Stored. This format can't be previewed in the browser — it can be downloaded.");
      if (probe.thumbnail) {
        const { error } = await supabase.storage
          .from(target.bucket)
          .upload(target.thumbnailObjectName, probe.thumbnail, { contentType: "image/jpeg", upsert: true });
        if (error) notes.push("The thumbnail couldn't be saved.");
      }
      const result = await finalizeAssetUpload({
        assetId: target.assetId,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
      });
      controllers.current.delete(key);
      if (!result.ok) {
        update(key, { type: "fail", error: result.error, retryable: result.retryable });
        return;
      }
      update(key, { type: "finalized", warning: notes.join(" ") || undefined });
      router.refresh();
    },
    [router, supabase, update],
  );

  const run = useCallback(
    async (key: string) => {
      const item = get(key);
      if (!item) return;
      update(key, item.phase === "queued" ? { type: "start" } : { type: "retry" });

      const type = resolveFileType(item.file.name, item.file.type);
      if (!type.ok) return update(key, { type: "fail", error: type.error, retryable: false });

      const [targetResult, probe] = await Promise.all([
        item.assetId
          ? retryAssetUpload(item.assetId)
          : createAssetUpload({
              projectId,
              fileName: item.file.name,
              size: item.file.size,
              browserMime: item.file.type,
              rootAssetId: item.rootAssetId,
            }),
        probeMedia(item.file, type.type.kind).catch((): MediaProbe => ({
          previewable: false,
          notes: ["The file couldn't be read for preview."],
        })),
      ]);
      if (get(key)?.phase === "cancelled") return;
      if (!targetResult.ok) {
        return update(key, { type: "fail", error: targetResult.error, retryable: targetResult.retryable });
      }
      const target = targetResult.target;
      update(key, { type: "created", assetId: target.assetId });

      const upload = createResumableUpload(
        item.file,
        target,
        {
          publishableKey,
          getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
        },
        {
          onProgress: (sent) => update(key, { type: "progress", bytesSent: sent }),
          onSuccess: () => void finish(key, target, probe),
          onError: (message, retryable) => {
            controllers.current.delete(key);
            void markAssetUploadFailed({ assetId: target.assetId, message });
            update(key, { type: "fail", error: message, retryable });
          },
        },
      );
      controllers.current.set(key, upload);
      try {
        await upload.start();
      } catch {
        update(key, { type: "fail", error: "The upload couldn't be started. Retry to try again.", retryable: true });
      }
    },
    [finish, projectId, publishableKey, supabase, update],
  );

  // Start queued uploads, at most MAX_PARALLEL at a time.
  useEffect(() => {
    const active = items.filter(isActive).length;
    const next = items
      .filter((i) => i.phase === "queued" && !started.current.has(i.key))
      .slice(0, Math.max(0, MAX_PARALLEL - active));
    for (const item of next) {
      started.current.add(item.key);
      void run(item.key);
    }
  }, [items, run]);

  // Warn before leaving while uploads are in flight.
  useEffect(() => {
    const busy = items.some(isActive);
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items]);

  const value: UploadQueueValue = {
    items,
    limitBytes,
    enqueue: (files, options) => {
      const added: QueueItem[] = files.map((file) => {
        const base: QueueItem = {
          key: crypto.randomUUID(),
          file,
          fileName: file.name,
          size: file.size,
          phase: "queued",
          bytesSent: 0,
          rootAssetId: options?.rootAssetId,
          label: options?.label,
          assetId: options?.resumeAssetId,
        };
        // Reject obviously invalid files before anything is created.
        const type = resolveFileType(file.name, file.type);
        const sizeError = checkFileSize(file.size, limitBytes);
        const error = !type.ok ? type.error : sizeError;
        return error ? { ...base, phase: "error", error, retryable: false } : base;
      });
      setItems((list) => [...list, ...added]);
    },
    pause: (key) => {
      const c = controllers.current.get(key);
      if (!c || get(key)?.phase !== "uploading") return;
      void c.pause();
      update(key, { type: "pause" });
    },
    resume: (key) => {
      const c = controllers.current.get(key);
      if (!c || get(key)?.phase !== "paused") return;
      update(key, { type: "resume" });
      c.resume();
    },
    cancel: (key) => {
      const item = get(key);
      if (!item) return;
      update(key, { type: "cancel" });
      const c = controllers.current.get(key);
      controllers.current.delete(key);
      void (async () => {
        await c?.cancel();
        if (item.assetId) {
          const result = await cancelAssetUpload(item.assetId);
          if (!result.ok) toast.error(result.error);
          router.refresh();
        }
        setItems((list) => list.filter((i) => i.key !== key));
      })();
    },
    retry: (key) => {
      const item = get(key);
      if (!item || item.phase !== "error" || !item.retryable) return;
      void run(key);
    },
    clearFinished: () =>
      setItems((list) => list.filter((i) => i.phase !== "done" && !(i.phase === "error" && !i.retryable))),
  };

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}
