import { Badge } from "@/components/ui/badge";
import { APPROVAL_STATUS_LABELS, REVISION_STATUS_LABELS } from "@/lib/validation/approvals";
import type { ApprovalStatus, RevisionStatus } from "@/types/database";

const APPROVAL_VARIANT: Record<ApprovalStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "warning",
  approved: "success",
  changes_requested: "brand",
  cancelled: "outline",
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return <Badge variant={APPROVAL_VARIANT[status]}>{APPROVAL_STATUS_LABELS[status]}</Badge>;
}

const REVISION_VARIANT: Record<RevisionStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  open: "warning",
  in_progress: "brand",
  completed: "success",
};

export function RevisionStatusBadge({ status }: { status: RevisionStatus }) {
  return <Badge variant={REVISION_VARIANT[status]}>{REVISION_STATUS_LABELS[status]}</Badge>;
}
