import Link from "next/link";
import { CheckCircle2Icon, EyeIcon, EyeOffIcon, GitPullRequestArrowIcon, RotateCcwIcon } from "lucide-react";
import { ApprovalStatusBadge, RevisionStatusBadge } from "@/components/approvals/approval-badges";
import { CancelApprovalButton, RevisionStatusSelect } from "@/components/approvals/approval-controls";
import { EmptyState } from "@/components/app/empty-state";
import { ProjectPortalDialog } from "@/components/projects/project-portal-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { Project } from "@/types/database";

type Person = { id: string; name: string };

/** Project page: client-portal settings, approval requests and revision rounds. */
export async function ProjectApprovals({
  project,
  clientName,
  people,
  currentUserId,
  canManage,
}: {
  project: Pick<
    Project,
    "id" | "workspace_id" | "client_id" | "client_visible" | "client_summary" | "allow_client_downloads" | "archived_at"
  >;
  clientName: string | null;
  people: Person[];
  currentUserId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const [approvals, revisions, assets] = await Promise.all([
    supabase
      .from("approvals")
      .select(
        "id, asset_id, title, message, status, requested_by, decided_by, decided_at, decision_note, due_date, created_at",
      )
      .eq("project_id", project.id)
      .eq("workspace_id", project.workspace_id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("revisions")
      .select("id, round_number, summary, status, asset_id, requested_by, completed_at, created_at")
      .eq("project_id", project.id)
      .eq("workspace_id", project.workspace_id)
      .order("round_number", { ascending: false })
      .limit(50),
    supabase
      .from("assets")
      .select("id, name, version_number")
      .eq("project_id", project.id)
      .eq("workspace_id", project.workspace_id),
  ]);
  const failed = [approvals, revisions, assets].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load approvals: ${failed.error.message}`);

  // Client users aren't in `people` (staff only); their names come from co-member profiles.
  const ids = [
    ...new Set(
      [
        ...(approvals.data ?? []).flatMap((a) => [a.requested_by, a.decided_by]),
        ...(revisions.data ?? []).map((r) => r.requested_by),
      ].filter((x): x is string => Boolean(x) && !people.some((p) => p.id === x)),
    ),
  ];
  const { data: extra } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const nameOf = (id: string | null) =>
    people.find((p) => p.id === id)?.name ??
    extra?.find((p) => p.id === id)?.full_name ??
    extra?.find((p) => p.id === id)?.email ??
    "Someone";
  const fileOf = (id: string | null) => assets.data?.find((a) => a.id === id);
  const fileLabel = (id: string | null) => {
    const f = fileOf(id);
    return f ? `${f.name} · v${f.version_number}` : "Deleted file";
  };

  const list = approvals.data ?? [];
  const pending = list.filter((a) => a.status === "pending");
  const rounds = revisions.data ?? [];
  const portalReady = Boolean(project.client_id) && project.client_visible && !project.archived_at;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle>Client portal</CardTitle>
            <CardDescription>{clientName ?? "No client"}</CardDescription>
          </div>
          {canManage ? <ProjectPortalDialog project={project} clientName={clientName} /> : null}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="flex items-center gap-2">
            {portalReady ? (
              <>
                <EyeIcon className="size-4 text-success" /> Visible to {clientName}&apos;s portal users
              </>
            ) : (
              <>
                <EyeOffIcon className="size-4 text-muted-foreground" />
                {!project.client_id
                  ? "Hidden: the project has no client"
                  : project.archived_at
                    ? "Hidden while archived"
                    : "Hidden from the client portal"}
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            Downloads {project.allow_client_downloads ? "allowed" : "turned off"} for the client.
          </p>
          {project.client_summary ? (
            <p className="border-t pt-3 whitespace-pre-wrap">{project.client_summary}</p>
          ) : (
            <p className="border-t pt-3 text-muted-foreground">No client-facing summary yet.</p>
          )}
          {!portalReady ? (
            <p className="text-xs text-muted-foreground">
              Approvals can be requested once the project is visible in the portal.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
          <CardDescription>
            {pending.length ? `${pending.length} awaiting the client` : "Nothing awaiting the client"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.length ? (
            <ul className="divide-y">
              {list.map((a) => (
                <li key={a.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0" data-approval-id={a.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                    <ApprovalStatusBadge status={a.status} />
                  </div>
                  {a.asset_id && fileOf(a.asset_id) ? (
                    <Link
                      href={`/app/projects/${project.id}/assets/${a.asset_id}`}
                      className="truncate text-xs text-brand hover:underline"
                    >
                      {fileLabel(a.asset_id)}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">{fileLabel(a.asset_id)}</span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Requested by {nameOf(a.requested_by)} {formatRelativeTime(a.created_at)}
                    {a.due_date && a.status === "pending" ? ` · due ${formatDate(a.due_date)}` : ""}
                  </p>
                  {a.decided_at && a.status !== "pending" ? (
                    <p className="text-xs text-muted-foreground">
                      {a.status === "cancelled" ? "Cancelled" : "Decided"} by {nameOf(a.decided_by)}{" "}
                      {formatRelativeTime(a.decided_at)}
                    </p>
                  ) : null}
                  {a.decision_note ? (
                    <p className="rounded-md bg-muted px-2 py-1.5 text-xs whitespace-pre-wrap">{a.decision_note}</p>
                  ) : null}
                  {a.status === "pending" && (canManage || a.requested_by === currentUserId) ? (
                    <div>
                      <CancelApprovalButton approvalId={a.id} title={a.title} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CheckCircle2Icon}
              title="No approval requests"
              description="Open a file and choose Request approval to ask the client to sign off a version."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revision rounds</CardTitle>
          <CardDescription>Opened automatically when the client requests changes.</CardDescription>
        </CardHeader>
        <CardContent>
          {rounds.length ? (
            <ul className="divide-y">
              {rounds.map((r) => (
                <li key={r.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0" data-revision-id={r.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <RotateCcwIcon className="size-3.5 text-muted-foreground" /> Round {r.round_number}
                    </span>
                    {project.archived_at ? (
                      <RevisionStatusBadge status={r.status} />
                    ) : (
                      <RevisionStatusSelect revisionId={r.id} round={r.round_number} status={r.status} />
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{r.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {nameOf(r.requested_by)} · {formatRelativeTime(r.created_at)}
                    {r.asset_id && fileOf(r.asset_id) ? (
                      <>
                        {" · "}
                        <Link
                          href={`/app/projects/${project.id}/assets/${r.asset_id}`}
                          className="text-brand hover:underline"
                        >
                          {fileLabel(r.asset_id)}
                        </Link>
                      </>
                    ) : null}
                    {r.completed_at ? ` · completed ${formatRelativeTime(r.completed_at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={GitPullRequestArrowIcon}
              title="No revision rounds"
              description="When the client requests changes, the next round appears here."
            />
          )}
          {rounds.some((r) => r.status !== "completed") ? (
            <p className="mt-3 text-xs text-muted-foreground">
              A client approval moves the project to Approved only once every round is completed.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
