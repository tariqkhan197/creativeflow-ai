"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { setTaskStatus } from "@/lib/actions/tasks";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/validation/tasks";
import type { TaskStatus } from "@/types/database";

/** Moves a task between board columns. The board re-renders from the server after the change. */
export function TaskStatusSelect({ taskId, status, title }: { taskId: string; status: TaskStatus; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <NativeSelect
      aria-label={`Status of ${title}`}
      defaultValue={status}
      disabled={pending}
      className="w-32 [&_select]:h-8 [&_select]:text-xs"
      onChange={(e) => {
        const select = e.currentTarget;
        const next = select.value as TaskStatus;
        startTransition(async () => {
          const result = await setTaskStatus(taskId, next);
          if (!result.ok) {
            select.value = status;
            toast.error(result.error);
          }
        });
      }}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {TASK_STATUS_LABELS[s]}
        </option>
      ))}
    </NativeSelect>
  );
}
