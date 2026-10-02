import { z } from "zod";
import type { ApprovalStatus, RevisionStatus } from "@/types/database";
import { optionalDate, optionalText } from "./common";

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
  "cancelled",
] as const satisfies readonly ApprovalStatus[];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  cancelled: "Cancelled",
};

export const REVISION_STATUSES = ["open", "in_progress", "completed"] as const satisfies readonly RevisionStatus[];

export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
};

/** Today as YYYY-MM-DD in UTC (the database compares with current_date). */
const todayUtc = () => new Date().toISOString().slice(0, 10);

export const requestApprovalSchema = z.object({
  assetId: z.uuid(),
  title: z.string().trim().min(1, "Give the approval a title").max(200, "Title is too long"),
  message: optionalText(5000, "Message"),
  dueDate: optionalDate.refine((v) => !v || v >= todayUtc(), "The due date can't be in the past"),
});

export const decideApprovalSchema = z
  .object({
    approvalId: z.uuid(),
    decision: z.enum(["approved", "changes_requested"], "Choose approve or request changes"),
    note: optionalText(5000, "Note"),
  })
  .refine((v) => v.decision !== "changes_requested" || Boolean(v.note), {
    path: ["note"],
    message: "Please describe the requested changes",
  });

export const approvalIdSchema = z.object({ approvalId: z.uuid() });
export const assetShareSchema = z.object({ assetId: z.uuid(), shared: z.boolean() });
export const revisionStatusSchema = z.object({ revisionId: z.uuid(), status: z.enum(REVISION_STATUSES) });

/** Checkbox fields send "on" when ticked and nothing when not. */
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const projectPortalSchema = z.object({
  projectId: z.uuid(),
  clientVisible: checkbox,
  clientSummary: optionalText(2000, "Client summary"),
  allowClientDownloads: checkbox,
});

/** Approvals page filter from search params; unknown values fall back to pending. */
export const approvalFiltersSchema = z.object({
  status: z
    .enum([...APPROVAL_STATUSES, "all"])
    .catch("pending")
    .default("pending"),
});
