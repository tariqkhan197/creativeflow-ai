import { Badge } from "@/components/ui/badge";
import { PROJECT_PRIORITY_LABELS, PROJECT_STATUS_LABELS } from "@/lib/validation/projects";
import type { ProjectPriority, ProjectStatus } from "@/types/database";

const STATUS_VARIANT: Record<ProjectStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  planning: "secondary",
  in_progress: "brand",
  in_review: "warning",
  revisions: "warning",
  approved: "success",
  delivered: "success",
  on_hold: "outline",
  cancelled: "outline",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_CLASS: Record<ProjectPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export function PriorityLabel({ priority }: { priority: ProjectPriority }) {
  return <span className={`text-xs font-medium ${PRIORITY_CLASS[priority]}`}>{PROJECT_PRIORITY_LABELS[priority]}</span>;
}
