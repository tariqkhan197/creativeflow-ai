import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { AssetKindIcon } from "@/components/assets/asset-kind-icon";
import { VersionHistory } from "@/components/assets/version-history";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAssetMediaUrls } from "@/lib/actions/assets";
import { formatBytes } from "@/lib/media/file-types";
import { formatTimecode } from "@/lib/media/timecode";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Review" };

const ASSET_COLUMNS =
  "id, name, kind, status, mime_type, size_bytes, duration_seconds, width, height, frame_rate, version_number, root_asset_id, uploaded_by, created_at, project_id";

export default async function AssetReviewPage({ params }: PageProps<"/app/projects/[projectId]/assets/[assetId]">) {
  const { user, active } = await getWorkspaceContext();
  // Client-portal review arrives in Phase 4; the RLS rules for it already exist.
  if (!isStaff(active.role)) notFound();
  const { projectId, assetId } = await params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(assetId).success) notFound();

  const supabase = await createClient();
  const [{ data: asset, error }, { data: project }] = await Promise.all([
    supabase
      .from("assets")
      .select(ASSET_COLUMNS)
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("workspace_id", active.id)
      .maybeSingle(),
    supabase.from("projects").select("id, name").eq("id", projectId).eq("workspace_id", active.id).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!asset || !project) notFound();

  const back = (
    <Link
      href={`/app/projects/${project.id}`}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" /> {project.name}
    </Link>
  );

  if (asset.status !== "ready") {
    return (
      <div className="grid gap-6">
        {back}
        <div className="grid justify-items-center gap-3 rounded-xl border px-6 py-16 text-center">
          <Loader2Icon className="size-6 text-muted-foreground" />
          <p className="font-medium">
            {asset.status === "failed" ? "This upload failed" : "This file is still uploading"}
          </p>
          <p className="text-sm text-muted-foreground">
            It can be reviewed once the upload has finished. Check the project&apos;s Files section.
          </p>
        </div>
      </div>
    );
  }

  const rootId = asset.root_asset_id ?? asset.id;
  const [{ data: versions }, media] = await Promise.all([
    supabase
      .from("assets")
      .select("id, version_number, name, size_bytes, created_at, uploaded_by, root_asset_id")
      .eq("workspace_id", active.id)
      .eq("status", "ready")
      .or(`id.eq.${rootId},root_asset_id.eq.${rootId}`)
      .order("version_number", { ascending: false }),
    getAssetMediaUrls(asset.id),
  ]);
  const uploaderIds = [...new Set((versions ?? []).map((v) => v.uploaded_by).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = uploaderIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", uploaderIds)
    : { data: [] };
  const nameOf = (id: string | null) => {
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? "Someone";
  };
  const canManage = canManageWork(active.role);
  const latest = versions?.[0];

  return (
    <div className="grid gap-6">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <AssetKindIcon kind={asset.kind} className="size-5 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{asset.name}</h1>
        <Badge variant="brand">v{asset.version_number}</Badge>
        {latest && latest.id !== asset.id ? (
          <Link
            href={`/app/projects/${project.id}/assets/${latest.id}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            Newer version available (v{latest.version_number}) →
          </Link>
        ) : null}
      </div>

      <ReviewWorkspace
        asset={asset}
        initialMedia={media.ok ? { url: media.url, downloadUrl: media.downloadUrl, expiresAt: media.expiresAt } : null}
        side={
          <>
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">Versions</CardTitle>
              </CardHeader>
              <CardContent className="px-2">
                <VersionHistory
                  projectId={project.id}
                  versions={versions ?? []}
                  currentId={asset.id}
                  nameOf={nameOf}
                  canDelete={(v) => canManage || v.uploaded_by === user.id}
                />
              </CardContent>
            </Card>
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
                  {asset.frame_rate ? <Detail label="Frame rate">{`${Number(asset.frame_rate)} fps`}</Detail> : null}
                  <Detail label="Uploaded">{formatDate(asset.created_at)}</Detail>
                </dl>
                {asset.kind === "video" && !asset.frame_rate ? (
                  <p className="mt-3 text-xs text-muted-foreground">Frame rate unknown — frame stepping uses 1/30 s.</p>
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
