import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, Trash2Icon } from "lucide-react";
import { ProjectApprovals } from "@/components/approvals/project-approvals";
import { ConfirmAction } from "@/components/app/confirm-action";
import { ProjectFiles } from "@/components/assets/project-files";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityLabel, ProjectStatusBadge } from "@/components/projects/project-badges";
import { AddProjectMember, ProjectStatusSelect, RemoveProjectMember } from "@/components/projects/project-controls";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { TaskBoard } from "@/components/tasks/task-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteProject, setProjectArchived } from "@/lib/actions/projects";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, initials } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/app/projects/[projectId]">) {
  const { user, active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();

  const supabase = await createClient();
  const [project, tasks, team, members, clients] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).eq("workspace_id", active.id).maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, description, status, assignee_id, due_date, position, created_by, completed_at")
      .eq("project_id", projectId)
      .eq("workspace_id", active.id),
    supabase.from("project_members").select("user_id").eq("project_id", projectId).eq("workspace_id", active.id),
    supabase.from("workspace_members").select("user_id").eq("workspace_id", active.id).neq("role", "client"),
    supabase.from("clients").select("id, name").eq("workspace_id", active.id).order("name").limit(500),
  ]);
  const failed = [project, tasks, team, members, clients].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load the project: ${failed.error.message}`);
  const p = project.data;
  if (!p) notFound();

  const staffIds = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = staffIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", staffIds)
    : { data: [] };
  const people = (profiles ?? [])
    .map((pr) => ({ id: pr.id, name: pr.full_name ?? pr.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teamIds = new Set((team.data ?? []).map((t) => t.user_id));
  const projectTeam = people.filter((x) => teamIds.has(x.id));
  const client = clients.data?.find((c) => c.id === p.client_id);
  const canManage = canManageWork(active.role);
  const taskList = tasks.data ?? [];
  const done = taskList.filter((t) => t.status === "done").length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6">
      <Link
        href="/app/projects"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Projects
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            {p.archived_at ? <Badge variant="outline">Archived</Badge> : <ProjectStatusBadge status={p.status} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {client ? (
              <Link href={`/app/clients/${client.id}`} className="hover:text-foreground hover:underline">
                {client.name}
              </Link>
            ) : (
              "No client"
            )}
            {" · "}
            <PriorityLabel priority={p.priority} /> priority
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!p.archived_at ? <ProjectStatusSelect projectId={p.id} status={p.status} /> : null}
          <ProjectFormDialog project={p} clients={clients.data ?? []} defaultCurrency={active.default_currency} />
          {canManage ? (
            <>
              <ConfirmAction
                title={p.archived_at ? "Restore this project?" : "Archive this project?"}
                description={
                  p.archived_at
                    ? "It will appear in the active project list again."
                    : "Archived projects are hidden from the active list and dashboard counts. You can restore them any time."
                }
                confirmLabel={p.archived_at ? "Restore" : "Archive"}
                destructive={false}
                action={setProjectArchived.bind(null, p.id, !p.archived_at)}
                trigger={
                  <Button variant="outline">
                    {p.archived_at ? <ArchiveRestoreIcon /> : <ArchiveIcon />} {p.archived_at ? "Restore" : "Archive"}
                  </Button>
                }
              />
              <ConfirmAction
                title={`Delete ${p.name}?`}
                description="The project, its tasks and all of its files (every version and thumbnail) are deleted permanently. Consider archiving instead."
                confirmLabel="Delete project"
                action={deleteProject.bind(null, p.id)}
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Delete project">
                    <Trash2Icon />
                  </Button>
                }
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {p.description ? (
              <p className="text-sm whitespace-pre-wrap">{p.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No brief yet. Use Edit to add one.</p>
            )}
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Detail label="Start">{p.start_date ? formatDate(p.start_date) : "—"}</Detail>
              <Detail label="Due">{p.due_date ? formatDate(p.due_date) : "—"}</Detail>
              <Detail label="Budget">{p.budget_cents !== null ? formatMoney(p.budget_cents, p.currency) : "—"}</Detail>
              <Detail label="Tasks">{taskList.length ? `${done} of ${taskList.length} done` : "None"}</Detail>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project team</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {projectTeam.length ? (
              <ul className="grid gap-2">
                {projectTeam.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                      {initials(m.name)}
                    </span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {canManage ? <RemoveProjectMember projectId={p.id} userId={m.id} name={m.name} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody is assigned yet.</p>
            )}
            {canManage ? (
              <AddProjectMember projectId={p.id} candidates={people.filter((x) => !teamIds.has(x.id))} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3" aria-labelledby="approvals-heading">
        <h2 id="approvals-heading" className="text-lg font-semibold tracking-tight">
          Client portal &amp; approvals
        </h2>
        <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
          <ProjectApprovals
            project={p}
            clientName={client?.name ?? null}
            people={people}
            currentUserId={user.id}
            canManage={canManage}
          />
        </Suspense>
      </section>

      <section className="grid gap-3" aria-labelledby="files-heading">
        <h2 id="files-heading" className="text-lg font-semibold tracking-tight">
          Files &amp; reviews
        </h2>
        <Suspense fallback={<FilesSkeleton />}>
          <ProjectFiles
            projectId={p.id}
            workspaceId={active.id}
            currentUserId={user.id}
            archived={Boolean(p.archived_at)}
            people={people}
            canManage={canManage}
          />
        </Suspense>
      </section>

      <section className="grid gap-3" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-lg font-semibold tracking-tight">
          Tasks
        </h2>
        <TaskBoard
          projectId={p.id}
          tasks={taskList}
          people={people}
          currentUserId={user.id}
          canManage={canManage}
          today={today}
        />
      </section>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function FilesSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading files">
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
