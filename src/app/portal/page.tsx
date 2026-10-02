import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, CheckCircle2Icon, FilesIcon, FolderKanbanIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PortalStatusBadge } from "@/components/portal/portal-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortalContext } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Client portal" };

export default async function PortalHomePage({ searchParams }: PageProps<"/portal">) {
  const { profile, active } = await getPortalContext();
  const params = await searchParams;
  const supabase = await createClient();

  // portal_projects() returns only safe columns of this client's visible projects;
  // RLS limits approvals to versions this user can see.
  const [{ data: projects, error }, { data: pending, error: pendingError }] = await Promise.all([
    supabase.rpc("portal_projects", { p_workspace: active.id }),
    supabase
      .from("approvals")
      .select("id, project_id, asset_id, title, message, due_date, created_at")
      .eq("workspace_id", active.id)
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  if (error || pendingError) throw new Error(`Could not load your projects: ${(error ?? pendingError)?.message}`);

  const assetIds = [...new Set((pending ?? []).map((a) => a.asset_id).filter((x): x is string => Boolean(x)))];
  const { data: assets } = assetIds.length
    ? await supabase.from("assets").select("id, name, version_number").in("id", assetIds)
    : { data: [] };
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? "Project";
  const today = new Date().toISOString().slice(0, 10);
  const firstName = profile?.full_name?.split(" ")[0];
  const waiting = (pending ?? []).filter((a) => a.asset_id && assets?.some((x) => x.id === a.asset_id));

  return (
    <div className="grid gap-8">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={`Projects ${active.name} has shared with you.`}
      />
      {params.joined === "1" ? (
        <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success" role="status">
          You now have access to {active.name}&apos;s client portal.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Waiting for your approval</CardTitle>
          <CardDescription>
            {waiting.length
              ? `${waiting.length} ${waiting.length === 1 ? "item needs" : "items need"} your decision.`
              : "Nothing needs your decision right now."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waiting.length ? (
            <ul className="divide-y" aria-label="Waiting for your approval">
              {waiting.map((a) => {
                const asset = assets?.find((x) => x.id === a.asset_id);
                const overdue = a.due_date !== null && a.due_date < today;
                return (
                  <li key={a.id} data-approval-id={a.id}>
                    <Link
                      href={`/portal/projects/${a.project_id}/files/${a.asset_id}`}
                      className="flex flex-wrap items-center gap-3 py-3 hover:underline"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-medium">{a.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {projectName(a.project_id)} · {asset?.name} v{asset?.version_number} · sent{" "}
                          {formatRelativeTime(a.created_at)}
                        </span>
                      </span>
                      {a.due_date ? (
                        <span
                          className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}
                        >
                          {overdue ? "Overdue · " : "Due "}
                          {formatDate(a.due_date)}
                        </span>
                      ) : null}
                      <Badge variant="warning">Review</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={CheckCircle2Icon}
              title="You're all caught up"
              description="When the team asks you to approve a file, it will appear here and you'll get a notification."
            />
          )}
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="text-lg font-semibold tracking-tight">
          Your projects
        </h2>
        {projects && projects.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/portal/projects/${p.id}`}
                  className="grid h-full gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-brand/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <PortalStatusBadge status={p.status} />
                  </div>
                  {p.client_summary ? (
                    <p className="line-clamp-3 text-sm text-muted-foreground">{p.client_summary}</p>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <FilesIcon className="size-3.5" /> {p.shared_files} {p.shared_files === 1 ? "file" : "files"}
                    </span>
                    {p.pending_approvals ? (
                      <span className="inline-flex items-center gap-1 font-medium text-warning">
                        <CheckCircle2Icon className="size-3.5" /> {p.pending_approvals} to approve
                      </span>
                    ) : null}
                    {p.due_date ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarIcon className="size-3.5" /> Due {formatDate(p.due_date)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FolderKanbanIcon}
            title="Nothing shared yet"
            description={`When ${active.name} shares a project with you, it will appear here for review and approval.`}
          />
        )}
      </section>
    </div>
  );
}
