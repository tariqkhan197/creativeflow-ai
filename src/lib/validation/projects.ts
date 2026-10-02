import { z } from "zod";
import type { ProjectPriority, ProjectStatus } from "@/types/database";
import { currencySchema, optionalDate, optionalMoneyCents, optionalText, optionalUuid } from "./common";

export const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "in_review",
  "revisions",
  "approved",
  "delivered",
  "on_hold",
  "cancelled",
] as const satisfies readonly ProjectStatus[];

export const PROJECT_PRIORITIES = ["low", "medium", "high", "urgent"] as const satisfies readonly ProjectPriority[];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  in_progress: "In progress",
  in_review: "In review",
  revisions: "Revisions",
  approved: "Approved",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, "Use at least 2 characters").max(140, "Name is too long"),
    description: optionalText(10000, "Description"),
    clientId: optionalUuid,
    status: z.enum(PROJECT_STATUSES, "Choose a status").default("planning"),
    priority: z.enum(PROJECT_PRIORITIES, "Choose a priority").default("medium"),
    startDate: optionalDate,
    dueDate: optionalDate,
    budget: optionalMoneyCents,
    currency: currencySchema,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    path: ["dueDate"],
    message: "Due date can't be before the start date",
  });

export const updateProjectSchema = z.intersection(projectSchema, z.object({ projectId: z.uuid() }));
export const projectIdSchema = z.object({ projectId: z.uuid() });
export const projectStatusSchema = z.object({
  projectId: z.uuid(),
  status: z.enum(PROJECT_STATUSES),
});
export const projectMemberSchema = z.object({ projectId: z.uuid(), userId: z.uuid() });

/** Validated list filters from search params. Unknown values are ignored. */
export const projectFiltersSchema = z.object({
  q: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 100) : undefined), z.string().optional()),
  status: z.enum(PROJECT_STATUSES).optional().catch(undefined),
  client: z.uuid().optional().catch(undefined),
  view: z.enum(["active", "archived"]).catch("active").default("active"),
});
