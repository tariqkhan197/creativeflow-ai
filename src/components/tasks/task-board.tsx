import { CalendarIcon, ListTodoIcon, Trash2Icon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskStatusSelect } from "@/components/tasks/task-status-select";
import { Button } from "@/components/ui/button";
import { deleteTask } from "@/lib/actions/tasks";
import { cn, formatDate, initials } from "@/lib/utils";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/validation/tasks";
import type { Task } from "@/types/database";

type Person = { id: string; name: string };
export type BoardTask = Pick<
  Task,
  "id" | "title" | "description" | "status" | "assignee_id" | "due_date" | "position" | "created_by" | "completed_at"
>;

export function TaskBoard({
  projectId,
  tasks,
  people,
  currentUserId,
  canManage,
  today,
}: {
  projectId: string;
  tasks: BoardTask[];
  people: Person[];
  currentUserId: string;
  canManage: boolean;
  today: string;
}) {
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name;

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTodoIcon}
        title="No tasks yet"
        description="Break the project into tasks, assign them to your team and track them to done."
        action={<TaskFormDialog projectId={projectId} people={people} />}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <TaskFormDialog projectId={projectId} people={people} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const column = tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABELS[status]}
              className="grid content-start gap-2 rounded-xl border bg-muted/30 p-3"
            >
              <header className="flex items-center justify-between px-1">
                <h3 className="text-sm font-medium">
                  {TASK_STATUS_LABELS[status]}{" "}
                  <span className="text-muted-foreground tabular-nums">{column.length}</span>
                </h3>
                <TaskFormDialog projectId={projectId} people={people} defaultStatus={status} compact />
              </header>
              {column.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
              ) : null}
              {column.map((t) => {
                const assignee = nameOf(t.assignee_id);
                const overdue = t.due_date && t.status !== "done" && t.due_date < today;
                const canDelete = canManage || t.created_by === currentUserId;
                return (
                  <article key={t.id} className="grid gap-2 rounded-lg border bg-card p-3 shadow-xs">
                    <div className="flex items-start gap-2">
                      <p
                        className={cn(
                          "flex-1 text-sm font-medium",
                          t.status === "done" && "text-muted-foreground line-through",
                        )}
                      >
                        {t.title}
                      </p>
                      <div className="-mt-1 -mr-1 flex">
                        <TaskFormDialog projectId={projectId} people={people} task={t} />
                        {canDelete ? (
                          <ConfirmAction
                            title="Delete this task?"
                            description={`“${t.title}” will be deleted permanently.`}
                            confirmLabel="Delete task"
                            action={deleteTask.bind(null, t.id)}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.title}`}>
                                <Trash2Icon />
                              </Button>
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                    {t.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {assignee ? (
                        <span className="inline-flex items-center gap-1.5" title={assignee}>
                          <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">
                            {initials(assignee)}
                          </span>
                          <span className="max-w-24 truncate">{assignee}</span>
                        </span>
                      ) : (
                        <span>Unassigned</span>
                      )}
                      {t.due_date ? (
                        <span
                          className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}
                        >
                          <CalendarIcon className="size-3" />
                          {formatDate(t.due_date, { month: "short", day: "numeric" })}
                        </span>
                      ) : null}
                    </div>
                    <TaskStatusSelect taskId={t.id} status={t.status} title={t.title} />
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
