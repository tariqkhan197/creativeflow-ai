import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, CheckCircle2Icon, FilesIcon, RotateCcwIcon } from "lucide-react";
import { ApprovalStatusBadge, RevisionStatusBadge } from "@/components/approvals/approval-badges";
import { EmptyState } from "@/components/app/empty-state";
import { AssetKindIcon } from "@/components/assets/asset-kind-icon";
import { PortalStatusBadge } from "@/components/portal/portal-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/media/server";
import { formatTimecode } from "@/lib/media/timecode";
import { getPortalContext } from "@/lib/portal";
import { groupPortalFiles } from "@/lib/portal-files";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";
import type { AssetKind } from "@/types/database";

export const metadata: Metadata = { title: "Project" };

export default async function PortalProjectPage({ params }: PageProps<"/portal/projects/[projectId]">) {
  const { user, active } = await getPortalContext();
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();

  const supabase = await createClient();
  // The database decides visibility: nothing is returned unless this user's client owns
  // the project and it is shown in the portal.
  const { data: rows, error } = await supabase.rpc("portal_project", { p_project: projectId });
  if (error) throw new Error(`Could not load the project: ${error.message}`);
  const project = rows?.[0];
  if (!project || project.workspace_id !== active.id) notFound();

  const [files, approvals, revisions] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, kind, size_bytes, duration_seconds, version_number, root_asset_id, thumbnail_path, created_at")
      .eq("project_id", project.id)
      .eq("workspace_id", active.id)
      .eq("status", "ready")
      .eq("shared_with_client", true),
    supabase
      .from("approvals")
      .select("id, asset_id, title, message, status, decided_by, decided_at, decision_note, due_date, created_at")
      .eq("project_id", project.id)
      .eq("workspace_id", active.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("revisions")
      .select("id, round_number, summary, status, completed_at, created_at")
      .eq("project_id", project.id)
      .eq("workspace_id", active.id)
      .order("round_number", { ascending: false })
      .limit(20),
  ]);
  const failed = [files, approvals, revisions].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load the project: ${failed.error.message}`);

  const groups = groupPortalFiles(files.data ?? []);
  const thumbPaths = groups.map((g) => g.latest.thumbnail_path).filter((p): p is string => Boolean(p));
  const { data: signed } = thumbPaths.length
    ? await supabase.storage.from(ASSET_BUCKET).createSignedUrls(thumbPaths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };
  const thumbUrl = (path: string | null) => (path ? signed?.find((s) => s.path === path)?.signedUrl : undefined);

  const list = approvals.data ?? [];
  const pending = list.filter((a) => a.status === "pending");
  const decided = list.filter((a) => a.status !== "pending");
  const pendingFor = (assetId: string) => pending.find((a) => a.asset_id === assetId);
  const fileOf = (id: string | null) => files.data?.find((f) => f.id === id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6">
      <Link
        href="/portal"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> All projects
      </Link>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <PortalStatusBadge status={project.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {project.client_name}
          {project.start_date ? ` · Started ${formatDate(project.start_date)}` : ""}
          {project.due_date ? ` · Due ${formatDate(project.due_date)}` : ""}
        </p>
        {project.client_summary ? (
          <p className="max-w-3xl text-sm whitespace-pre-wrap">{project.client_summary}</p>
        ) : null}
      </div>

      {pending.length ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Waiting for your approval</CardTitle>
            <CardDescription>Open a file to review it, then approve it or request changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y" aria-label="Waiting for your approval">
              {pending.map((a) => {
                const f = fileOf(a.asset_id);
                if (!f) return null;
                const overdue = a.due_date !== null && a.due_date < today;
                return (
                  <li key={a.id} data-approval-id={a.id}>
                    <Link
                      href={`/portal/projects/${project.id}/files/${f.id}`}
                      className="flex flex-wrap items-center gap-3 py-3 hover:underline"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-medium">{a.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {f.name} · v{f.version_number}
                          {a.message ? ` · “${a.message.slice(0, 120)}”` : ""}
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
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3" aria-labelledby="files-heading">
        <h2 id="files-heading" className="text-lg font-semibold tracking-tight">
          Shared files
        </h2>
        {groups.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Shared files">
            {groups.map(({ rootId, latest, versions }) => {
              const url = thumbUrl(latest.thumbnail_path);
              const waiting = versions.some((v) => pendingFor(v.id));
              return (
                <li
                  key={rootId}
                  className="overflow-hidden rounded-xl border bg-card shadow-xs"
                  data-asset-id={latest.id}
                >
                  <Link
                    href={`/portal/projects/${project.id}/files/${latest.id}`}
                    className="relative flex aspect-video items-center justify-center bg-muted"
                    aria-label={`Review ${latest.name}`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
                      <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <AssetKindIcon kind={latest.kind as AssetKind} className="size-8 text-muted-foreground" />
                    )}
                    {latest.duration_seconds ? (
                      <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
                        {formatTimecode(Number(latest.duration_seconds))}
                      </span>
                    ) : null}
                  </Link>
                  <div className="grid gap-1.5 p-3">
                    <Link
                      href={`/portal/projects/${project.id}/files/${latest.id}`}
                      className="truncate text-sm font-medium hover:underline"
                      title={latest.name}
                    >
                      {latest.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={versions.length > 1 ? "brand" : "secondary"}>v{latest.version_number}</Badge>
                      {waiting ? <Badge variant="warning">Awaiting your approval</Badge> : null}
                      <span>Shared {formatRelativeTime(latest.created_at)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={FilesIcon}
            title="No files shared yet"
            description="When the team shares a cut, image or document with you, it will appear here."
          />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            {decided.length ? (
              <ul className="divide-y">
                {decided.map((a) => {
                  const f = fileOf(a.asset_id);
                  return (
                    <li key={a.id} className="grid gap-1 py-3 first:pt-0 last:pb-0" data-approval-id={a.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                        <ApprovalStatusBadge status={a.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {f ? `${f.name} · v${f.version_number} · ` : ""}
                        {a.decided_by === user.id ? "You · " : ""}
                        {a.decided_at ? formatRelativeTime(a.decided_at) : ""}
                      </p>
                      {a.decision_note ? (
                        <p className="rounded-md bg-muted px-2 py-1.5 text-xs whitespace-pre-wrap">{a.decision_note}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={CheckCircle2Icon}
                title="No decisions yet"
                description="Your approvals and change requests will be listed here."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revision rounds</CardTitle>
            <CardDescription>Each change request opens a round the team works through.</CardDescription>
          </CardHeader>
          <CardContent>
            {(revisions.data ?? []).length ? (
              <ul className="divide-y">
                {(revisions.data ?? []).map((r) => (
                  <li key={r.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                        <RotateCcwIcon className="size-3.5 text-muted-foreground" /> Round {r.round_number}
                      </span>
                      <RevisionStatusBadge status={r.status} />
                    </div>
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{r.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      Opened {formatRelativeTime(r.created_at)}
                      {r.completed_at ? ` · completed ${formatRelativeTime(r.completed_at)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={RotateCcwIcon}
                title="No revision rounds"
                description="If you request changes, the round and its progress appear here."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
