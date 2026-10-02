import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon } from "lucide-react";
import { AssetKindIcon } from "@/components/assets/asset-kind-icon";
import { DecisionPanel, type PortalApproval } from "@/components/portal/decision-panel";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAssetMediaUrls } from "@/lib/actions/assets";
import { formatBytes } from "@/lib/media/file-types";
import { formatTimecode } from "@/lib/media/timecode";
import { getPortalContext } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Review" };

const ASSET_COLUMNS =
  "id, name, kind, status, mime_type, size_bytes, duration_seconds, width, height, frame_rate, version_number, root_asset_id, created_at, project_id";

export default async function PortalFilePage({ params }: PageProps<"/portal/projects/[projectId]/files/[assetId]">) {
  const { user, active } = await getPortalContext();
  const { projectId, assetId } = await params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(assetId).success) notFound();

  const supabase = await createClient();
  // Both checks are the database's: portal_project() only returns this client's visible
  // project, and RLS only returns shared, uploaded versions of it.
  const [{ data: projectRows, error: projectError }, { data: asset, error }] = await Promise.all([
    supabase.rpc("portal_project", { p_project: projectId }),
    supabase
      .from("assets")
      .select(ASSET_COLUMNS)
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("workspace_id", active.id)
      .eq("status", "ready")
      .maybeSingle(),
  ]);
  if (projectError || error) throw new Error(`Could not load the file: ${(projectError ?? error)?.message}`);
  const project = projectRows?.[0];
  if (!project || !asset) notFound();

  const rootId = asset.root_asset_id ?? asset.id;
  const [{ data: versions }, media, { data: comments, error: commentsError }, { data: approvals, error: apError }] =
    await Promise.all([
      supabase
        .from("assets")
        .select("id, version_number, name, created_at")
        .eq("workspace_id", active.id)
        .eq("status", "ready")
        .or(`id.eq.${rootId},root_asset_id.eq.${rootId}`)
        .order("version_number", { ascending: false }),
      getAssetMediaUrls(asset.id),
      supabase
        .from("review_comments")
        .select(
          "id, asset_id, parent_id, author_id, body, timestamp_seconds, annotation, is_internal, resolved_at, resolved_by, edited_at, created_at, updated_at",
        )
        .eq("asset_id", asset.id)
        .eq("workspace_id", active.id)
        .order("created_at"),
      supabase
        .from("approvals")
        .select("id, title, message, status, requested_by, decided_by, decided_at, decision_note, due_date, created_at")
        .eq("asset_id", asset.id)
        .eq("workspace_id", active.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
    ]);
  if (commentsError || apError) throw new Error(`Could not load this file: ${(commentsError ?? apError)?.message}`);

  // Clients can read staff profiles and their own; RLS hides everyone else.
  const ids = [
    ...new Set(
      [
        user.id,
        ...(comments ?? []).flatMap((c) => [c.author_id, c.resolved_by]),
        ...(approvals ?? []).map((a) => a.requested_by),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  const nameOf = (id: string | null) => {
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? active.name;
  };
  const toApproval = (a: NonNullable<typeof approvals>[number]): PortalApproval => ({
    id: a.id,
    title: a.title,
    message: a.message,
    status: a.status,
    requestedBy: nameOf(a.requested_by),
    dueDate: a.due_date,
    createdAt: a.created_at,
    decidedAt: a.decided_at,
    decisionNote: a.decision_note,
    decidedByMe: a.decided_by === user.id,
  });
  const pending = approvals?.find((a) => a.status === "pending");
  const latest = versions?.[0];

  return (
    <div className="grid gap-6">
      <Link
        href={`/portal/projects/${project.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> {project.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <AssetKindIcon kind={asset.kind} className="size-5 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{asset.name}</h1>
        <Badge variant="brand">v{asset.version_number}</Badge>
        {pending ? <Badge variant="warning">Awaiting your approval</Badge> : null}
        {latest && latest.id !== asset.id ? (
          <Link
            href={`/portal/projects/${project.id}/files/${latest.id}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            Newer version available (v{latest.version_number}) →
          </Link>
        ) : null}
      </div>

      <ReviewWorkspace
        asset={asset}
        initialMedia={media.ok ? { url: media.url, downloadUrl: media.downloadUrl, expiresAt: media.expiresAt } : null}
        initialComments={comments ?? []}
        people={(profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email }))}
        currentUserId={user.id}
        canManage={false}
        clientMode
        unknownName={`${project.client_name} reviewer`}
        asideTop={
          <DecisionPanel
            pending={pending ? toApproval(pending) : null}
            history={(approvals ?? []).filter((a) => a.status !== "pending").map(toApproval)}
          />
        }
        side={
          <>
            {versions && versions.length > 1 ? (
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm">Versions</CardTitle>
                </CardHeader>
                <CardContent className="px-2">
                  <ul className="grid gap-1" aria-label="Versions">
                    {versions.map((v) => (
                      <li key={v.id}>
                        <Link
                          href={`/portal/projects/${project.id}/files/${v.id}`}
                          aria-current={v.id === asset.id ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                            v.id === asset.id && "bg-accent font-medium",
                          )}
                        >
                          <Badge variant={v.id === asset.id ? "brand" : "secondary"}>v{v.version_number}</Badge>
                          <span className="min-w-0 flex-1 truncate">{v.name}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(v.created_at)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">Details</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Detail label="Type">{asset.mime_type}</Detail>
                  <Detail label="Size">{formatBytes(asset.size_bytes)}</Detail>
                  {asset.duration_seconds ? (
                    <Detail label="Duration">{formatTimecode(Number(asset.duration_seconds))}</Detail>
                  ) : null}
                  {asset.width && asset.height ? (
                    <Detail label="Dimensions">{`${asset.width} × ${asset.height}`}</Detail>
                  ) : null}
                  <Detail label="Shared">{formatDate(asset.created_at)}</Detail>
                </dl>
                {!project.allow_client_downloads ? (
                  <p className="mt-3 text-xs text-muted-foreground">Downloads are turned off for this project.</p>
                ) : null}
              </CardContent>
            </Card>
          </>
        }
      />
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}
