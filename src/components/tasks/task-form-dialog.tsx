"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextareaField } from "@/components/forms/textarea-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTask, updateTask } from "@/lib/actions/tasks";
import { initialFormState } from "@/lib/actions/types";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/validation/tasks";
import type { Task, TaskStatus } from "@/types/database";

type Person = { id: string; name: string };
type EditableTask = Pick<Task, "id" | "title" | "description" | "status" | "assignee_id" | "due_date">;

export function TaskFormDialog({
  projectId,
  people,
  task,
  defaultStatus = "todo",
  compact = false,
}: {
  projectId: string;
  people: Person[];
  task?: EditableTask;
  defaultStatus?: TaskStatus;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        {task ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${task.title}`}>
            <PencilIcon />
          </Button>
        ) : compact ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Add a task to ${TASK_STATUS_LABELS[defaultStatus]}`}>
            <PlusIcon />
          </Button>
        ) : (
          <Button variant="brand" size="sm">
            <PlusIcon /> Add task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <TaskForm
          key={formKey}
          projectId={projectId}
          people={people}
          task={task}
          defaultStatus={defaultStatus}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  projectId,
  people,
  task,
  defaultStatus,
  onSaved,
}: {
  projectId: string;
  people: Person[];
  task?: EditableTask;
  defaultStatus: TaskStatus;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(task ? updateTask : createTask, initialFormState);
  const e = state.fieldErrors ?? {};
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>Tasks are internal — clients never see them.</DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="projectId" value={projectId} />
      {task ? <input type="hidden" name="taskId" value={task.id} /> : null}
      <FormField
        label="Title"
        name="title"
        required
        defaultValue={v("title", task?.title ?? "")}
        errors={e.title}
        placeholder="Rough cut v1"
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label="Status"
          name="status"
          defaultValue={v("status", task?.status ?? defaultStatus)}
          errors={e.status}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Assignee"
          name="assigneeId"
          defaultValue={v("assigneeId", task?.assignee_id ?? "")}
          errors={e.assigneeId}
        >
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={v("dueDate", task?.due_date ?? "")}
          errors={e.dueDate}
        />
      </div>
      <TextareaField
        label="Details"
        name="description"
        rows={3}
        defaultValue={v("description", task?.description ?? "")}
        errors={e.description}
      />
      <DialogFooter>
        <SubmitButton pendingLabel="Saving…">{task ? "Save task" : "Add task"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
