/**
 * Upload queue item state machine. Pure, so every transition is unit-tested;
 * the uploader component only moves items through allowed transitions.
 *
 *   queued ─▶ creating ─▶ uploading ⇄ paused
 *                │            │
 *                │            ▼
 *                │        finalizing ─▶ done
 *                ▼            │
 *              error ◀────────┘ (any active state)  ─▶ retry → creating
 *   any non-terminal state ─▶ cancelled
 */
export type UploadPhase =
  "queued" | "creating" | "uploading" | "paused" | "finalizing" | "done" | "error" | "cancelled";

export type UploadItem = {
  key: string;
  fileName: string;
  size: number;
  phase: UploadPhase;
  bytesSent: number;
  assetId?: string;
  error?: string;
  /** Whether the error can be retried (validation errors cannot). */
  retryable?: boolean;
  warning?: string;
};

export type UploadEvent =
  | { type: "start" }
  | { type: "created"; assetId: string }
  | { type: "progress"; bytesSent: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "uploaded" }
  | { type: "finalized"; warning?: string }
  | { type: "fail"; error: string; retryable: boolean }
  | { type: "retry" }
  | { type: "cancel" };

const TERMINAL: UploadPhase[] = ["done", "cancelled"];

export class InvalidUploadTransition extends Error {}

export function transition(item: UploadItem, event: UploadEvent): UploadItem {
  const invalid = () => {
    throw new InvalidUploadTransition(`Cannot ${event.type} an upload that is ${item.phase}`);
  };
  switch (event.type) {
    case "start":
      return item.phase === "queued" ? { ...item, phase: "creating", error: undefined } : invalid();
    case "created":
      return item.phase === "creating" ? { ...item, phase: "uploading", assetId: event.assetId } : invalid();
    case "progress":
      if (item.phase !== "uploading" && item.phase !== "paused") return invalid();
      return { ...item, bytesSent: Math.min(Math.max(event.bytesSent, 0), item.size) };
    case "pause":
      return item.phase === "uploading" ? { ...item, phase: "paused" } : invalid();
    case "resume":
      return item.phase === "paused" ? { ...item, phase: "uploading" } : invalid();
    case "uploaded":
      return item.phase === "uploading" ? { ...item, phase: "finalizing", bytesSent: item.size } : invalid();
    case "finalized":
      return item.phase === "finalizing" ? { ...item, phase: "done", warning: event.warning } : invalid();
    case "fail":
      if (TERMINAL.includes(item.phase) || item.phase === "queued") return invalid();
      return { ...item, phase: "error", error: event.error, retryable: event.retryable };
    case "retry":
      if (item.phase !== "error" || !item.retryable) return invalid();
      // Keep assetId: the retry reuses the same database record and storage path.
      return { ...item, phase: "creating", error: undefined, bytesSent: 0 };
    case "cancel":
      return TERMINAL.includes(item.phase) ? invalid() : { ...item, phase: "cancelled" };
  }
}

export function canTransition(item: UploadItem, event: UploadEvent): boolean {
  try {
    transition(item, event);
    return true;
  } catch {
    return false;
  }
}

export function progressPercent(item: Pick<UploadItem, "bytesSent" | "size">): number {
  return item.size > 0 ? Math.round((item.bytesSent / item.size) * 100) : 0;
}

export const isActive = (item: UploadItem) => ["creating", "uploading", "paused", "finalizing"].includes(item.phase);
