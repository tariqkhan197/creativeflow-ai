import { Badge } from "@/components/ui/badge";
import { PORTAL_STATUS_LABELS } from "@/lib/portal-labels";
import type { ProjectStatus } from "@/types/database";

const VARIANT: Record<ProjectStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  planning: "secondary",
  in_progress: "secondary",
  in_review: "warning",
  revisions: "brand",
  approved: "success",
  delivered: "success",
  on_hold: "outline",
  cancelled: "outline",
};

export function PortalStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={VARIANT[status]}>{PORTAL_STATUS_LABELS[status]}</Badge>;
}
