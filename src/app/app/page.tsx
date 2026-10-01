import type { Metadata } from "next";
import Link from "next/link";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  ClockIcon,
  FolderKanbanIcon,
  PlayCircleIcon,
  ReceiptIcon,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrationStatus } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatRelativeTime } from "@/lib/utils";
import { getWorkspaceContext, MANAGER_ROLES, type WorkspaceWithRole } from "@/lib/workspace";
import type { ProjectStatus, WorkspaceOverview } from "@/types/database";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/app">) {
  const { profile, active } = await getWorkspaceContext();
  const params = await searchParams;
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="grid gap-8">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description={
          <>
            Here&apos;s what&apos;s happening in <span className="font-medium text-foreground">{active.name}</span>.
          </>
        }
      />
      {params.password === "updated" ? (
        <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success" role="status">
          Your password has been updated.
        </p>
      ) : null}
      {active.role === "client" ? <ClientHome workspace={active} /> : <StaffHome workspace={active} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff dashboard                                                             */
/* -------------------------------------------------------------------------- */

async function StaffHome({ workspace }: { workspace: WorkspaceWithRole }) {
  const supabase = await createClient();
  const [{ data: overviewData, error }, { data: activity }, integrations] = await Promise.all([
    supabase.rpc("workspace_overview", { p_workspace: workspace.id }),
    supabase
      .from("activity_log")
      .select("id, actor_id, entity_type, action, metadata, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(8),
    getIntegrationStatus(),
  ]);

  if (error || !overviewData) throw new Error(`Could not load workspace overview: ${error?.message ?? "no data"}`);
  const overview = overviewData as WorkspaceOverview;
  const canSeeFinance = MANAGER_ROLES.includes(workspace.role);

  const actorIds = [...new Set((activity ?? []).map((a) => a.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const actorName = (id: string | null) => {
    const p = actors?.find((a) => a.id === id);
    return p?.full_name ?? p?.email ?? "Someone";
  };

  const stats: { label: string; value: string; icon: LucideIcon; hint: string }[] = [
    {
      label: "Active projects",
      value: String(overview.active_projects),
      icon: FolderKanbanIcon,
      hint: "Not delivered or cancelled",
    },
    {
      label: "In review",
      value: String(overview.projects_in_review),
      icon: PlayCircleIcon,
      hint: "In client review or revisions",
    },
    {
      label: "Pending approvals",
      value: String(overview.pending_approvals),
      icon: ClockIcon,
      hint: "Awaiting a decision",
    },
    canSeeFinance && overview.outstanding_cents !== null
      ? {
          label: "Outstanding",
          value: formatMoney(overview.outstanding_cents, workspace.default_currency),
          icon: ReceiptIcon,
          hint: "Sent, unpaid invoices",
        }
      : {
          label: "Overdue tasks",
          value: String(overview.overdue_tasks),
          icon: AlertTriangleIcon,
          hint: "Past their due date",
        },
  ];

  const checklist = [
    { label: "Create your workspace", done: true },
    { label: "Invite your team", done: overview.members > 1, phase: 2 },
    { label: "Add your first client", done: overview.clients > 0, phase: 2 },
    { label: "Create your first project", done: overview.active_projects > 0, phase: 2 },
  ];
  const completed = checklist.filter((c) => c.done).length;

  return (
    <>
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center justify-between">
                {s.label}
                <s.icon className="size-4" />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 px-5">
              <p className="text-3xl font-semibold tracking-tight tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The latest changes across this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {activity && activity.length > 0 ? (
              <ol className="grid gap-4">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <ActivityIcon className="size-3.5 text-muted-foreground" />
                    </span>
                    <div className="grid gap-0.5">
                      <p className="text-sm">
                        <span className="font-medium">{actorName(a.actor_id)}</span> {describeAction(a.action)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatRelativeTime(a.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                icon={ActivityIcon}
                title="No activity yet"
                description="Project updates, uploads, comments and approvals will be listed here as your team works."
              />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Getting started</CardTitle>
              <CardDescription>
                {completed} of {checklist.length} complete
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${(completed / checklist.length) * 100}%` }}
                />
              </div>
              <ul className="grid gap-2.5">
                {checklist.map((item) => (
                  <li key={item.label} className="flex items-center gap-2.5 text-sm">
                    {item.done ? (
                      <CheckCircle2Icon className="size-4 text-success" />
                    ) : (
                      <CircleIcon className="size-4 text-muted-foreground/60" />
                    )}
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
                    {!item.done && item.phase ? (
                      <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
                        Phase {item.phase}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Configured on the server via environment variables.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5">
              {integrations
                .filter((i) => i.key !== "supabase-secret")
                .map((i) => (
                  <div key={i.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{i.label.split(" (")[0]}</span>
                    {i.configured ? (
                      <Badge variant="success">Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <CircleDashedIcon /> Not configured
                      </Badge>
                    )}
                  </div>
                ))}
              <Link href="/setup" className="mt-1 text-xs font-medium text-brand hover:underline">
                View setup guide →
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "workspace.created": "created the workspace",
  "member.joined": "joined the workspace",
  "approval.approved": "approved a deliverable",
  "approval.changes_requested": "requested changes",
};

function describeAction(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

/* -------------------------------------------------------------------------- */
/* Client-portal home                                                          */
/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  in_progress: "In progress",
  in_review: "Ready for review",
  revisions: "Revisions",
  approved: "Approved",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

async function ClientHome({ workspace }: { workspace: WorkspaceWithRole }) {
  const supabase = await createClient();
  // RLS limits this to client-visible projects of the client this user is bound to.
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, status, due_date, updated_at")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Could not load projects: ${error.message}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your projects</CardTitle>
        <CardDescription>Projects {workspace.name} has shared with you.</CardDescription>
      </CardHeader>
      <CardContent>
        {projects && projects.length > 0 ? (
          <ul className="divide-y">
            {projects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="grid gap-0.5">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(p.updated_at)}
                    {p.due_date ? ` · Due ${new Date(p.due_date).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Badge variant={p.status === "in_review" ? "brand" : "secondary"}>{STATUS_LABELS[p.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FolderKanbanIcon}
            title="Nothing shared yet"
            description="When the agency shares a project with you, it will appear here for review and approval."
          />
        )}
      </CardContent>
    </Card>
  );
}
