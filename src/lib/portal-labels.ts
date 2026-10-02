import type { ProjectStatus } from "@/types/database";

/** Client-facing project status wording. */
export const PORTAL_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  in_progress: "In production",
  in_review: "Ready for your review",
  revisions: "Revisions in progress",
  approved: "Approved",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};
