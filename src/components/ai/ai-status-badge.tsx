import { Badge } from "@/components/ui/badge";
import { isStalePending } from "@/lib/ai/studio";
import type { AiGenerationStatus } from "@/types/database";

/** Status of a generation; a run stuck past the timeout is shown as failed. */
export function AiStatusBadge({ status, createdAt }: { status: AiGenerationStatus; createdAt: string }) {
  if (status === "completed") return <Badge variant="success">Ready</Badge>;
  if (status === "failed" || isStalePending(status, createdAt)) return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="warning">Generating…</Badge>;
}
