import { z } from "zod";
import type { TaskStatus } from "@/types/database";
import { optionalDate, optionalText, optionalUuid } from "./common";

export const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

export const taskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "Enter a task title").max(200, "Title is too long"),
  description: optionalText(5000, "Description"),
  status: z.enum(TASK_STATUSES, "Choose a status").default("todo"),
  assigneeId: optionalUuid,
  dueDate: optionalDate,
});

export const updateTaskSchema = taskSchema.extend({ taskId: z.uuid() });
export const taskStatusSchema = z.object({ taskId: z.uuid(), status: z.enum(TASK_STATUSES) });
export const taskIdSchema = z.object({ taskId: z.uuid() });
