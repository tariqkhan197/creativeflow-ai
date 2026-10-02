"use client";

import { CheckCircle2Icon, Loader2Icon, PauseIcon, PlayIcon, RotateCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media/file-types";
import { progressPercent } from "@/lib/media/upload-state";
import { cn } from "@/lib/utils";
import { useUploadQueue, type QueueItem } from "./upload-queue";

const PHASE_LABEL: Record<QueueItem["phase"], string> = {
  queued: "Waiting…",
  creating: "Preparing…",
  uploading: "Uploading",
  paused: "Paused",
  finalizing: "Verifying upload…",
  done: "Uploaded",
  error: "Failed",
  cancelled: "Cancelling…",
};

export function UploadQueueList() {
  const { items, pause, resume, cancel, retry, clearFinished } = useUploadQueue();
  if (items.length === 0) return null;
  const finished = items.some((i) => i.phase === "done" || (i.phase === "error" && !i.retryable));

  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Uploads</p>
        {finished ? (
          <Button variant="ghost" size="sm" onClick={clearFinished}>
            Clear finished
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {items.map((item) => {
          const pct = progressPercent(item);
          const running = item.phase === "uploading" || item.phase === "paused";
          return (
            <li key={item.key} className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-start gap-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="truncate text-sm font-medium">
                    {item.label ? <span className="text-muted-foreground">{item.label} · </span> : null}
                    {item.fileName}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      item.phase === "error"
                        ? "text-destructive"
                        : item.phase === "done"
                          ? "text-success"
                          : "text-muted-foreground",
                    )}
                  >
                    {item.phase === "error" ? item.error : PHASE_LABEL[item.phase]}
                    {running ? ` · ${formatBytes(item.bytesSent)} of ${formatBytes(item.size)} (${pct}%)` : ""}
                  </p>
                  {item.phase === "done" && item.warning ? (
                    <p className="text-xs text-muted-foreground">{item.warning}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.phase === "creating" || item.phase === "finalizing" ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  ) : null}
                  {item.phase === "done" ? <CheckCircle2Icon className="size-4 text-success" aria-hidden /> : null}
                  {item.phase === "uploading" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => pause(item.key)}
                      aria-label={`Pause ${item.fileName}`}
                    >
                      <PauseIcon />
                    </Button>
                  ) : null}
                  {item.phase === "paused" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => resume(item.key)}
                      aria-label={`Resume ${item.fileName}`}
                    >
                      <PlayIcon />
                    </Button>
                  ) : null}
                  {item.phase === "error" && item.retryable ? (
                    <Button variant="outline" size="sm" onClick={() => retry(item.key)}>
                      <RotateCwIcon /> Retry
                    </Button>
                  ) : null}
                  {item.phase !== "done" &&
                  item.phase !== "cancelled" &&
                  !(item.phase === "error" && !item.retryable) ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => cancel(item.key)}
                      aria-label={`Cancel ${item.fileName}`}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              </div>
              {running || item.phase === "finalizing" ? (
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${item.fileName} upload progress`}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      item.phase === "paused" ? "bg-muted-foreground" : "bg-brand",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
