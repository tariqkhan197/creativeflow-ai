import Link from "next/link";
import { AlertTriangleIcon, FilesIcon, Loader2Icon, MessageSquareIcon, XIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { AssetCardMenu } from "@/components/assets/asset-card-menu";
import { AssetKindIcon } from "@/components/assets/asset-kind-icon";
import { ResumeUploadButton } from "@/components/assets/resume-upload-button";
import { UploadDropzone } from "@/components/assets/upload-dropzone";
import { UploadQueueList } from "@/components/assets/upload-queue-list";
import { UploadQueueProvider } from "@/components/assets/upload-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cancelAssetUpload } from "@/lib/actions/assets";
import { groupAssets, type AssetListRow } from "@/lib/media/asset-groups";
import { formatBytes } from "@/lib/media/file-types";
import { formatTimecode } from "@/lib/media/timecode";
import { ASSET_BUCKET, getUploadLimit, SIGNED_URL_TTL_SECONDS } from "@/lib/media/server";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/utils";

const COLUMNS =
  "id, name, kind, status, mime_type, size_bytes, duration_seconds, version_number, root_asset_id, thumbnail_path, uploaded_by, upload_error, created_at, shared_with_client";

export async function ProjectFiles({
  projectId,
  workspaceId,
  currentUserId,
  archived,
  people,
  canManage,
}: {
  projectId: string;
  workspaceId: string;
  currentUserId: string;
  archived: boolean;
  people: { id: string; name: string }[];
  canManage: boolean;
}) {
  const supabase = await createClient();
  const [{ data: rows, error }, { data: summary }, limit, { data: pendingApprovals }] = await Promise.all([
    supabase.from("assets").select(COLUMNS).eq("project_id", projectId).eq("workspace_id", workspaceId),
    supabase.from("asset_review_summary").select("root_asset_id, open_comment_count").eq("project_id", projectId),
    getUploadLimit(supabase),
    supabase
      .from("approvals")
      .select("asset_id")
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending"),
  ]);

  if (error) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        <AlertTriangleIcon className="size-4" /> Files couldn&apos;t be loaded. Refresh the page to try again.
      </div>
    );
  }

  const { groups, unfinished } = groupAssets(rows as AssetListRow[]);
  const thumbPaths = groups.map((g) => g.latest.thumbnail_path).filter((p): p is string => Boolean(p));
  const { data: signed } = thumbPaths.length
    ? await supabase.storage.from(ASSET_BUCKET).createSignedUrls(thumbPaths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };
  const thumbUrl = (path: string | null) => (path ? signed?.find((s) => s.path === path)?.signedUrl : undefined);
  const openCount = (rootId: string) => summary?.find((s) => s.root_asset_id === rootId)?.open_comment_count ?? 0;
  // Non-managers may only delete files whose every version they uploaded (Storage rule).
  const allUploadedBy = (rootId: string, userId: string) =>
    (rows as AssetListRow[])
      .filter((r) => r.id === rootId || r.root_asset_id === rootId)
      .every((r) => r.uploaded_by === userId);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "A teammate";
  const sharedIds = new Set(
    (rows as (AssetListRow & { shared_with_client: boolean })[]).filter((r) => r.shared_with_client).map((r) => r.id),
  );
  const pendingIds = new Set((pendingApprovals ?? []).map((a) => a.asset_id));

  return (
    <UploadQueueProvider projectId={projectId} limitBytes={limit.bytes}>
      <div className="grid gap-4">
        <UploadDropzone disabled={archived} disabledReason="Restore this project to upload files." />
        <UploadQueueList />

        {unfinished.length ? (
          <ul className="grid gap-2" aria-label="Unfinished uploads">
            {unfinished.map((a) => {
              const mine = a.uploaded_by === currentUserId;
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm"
                >
                  {a.status === "failed" ? (
                    <AlertTriangleIcon className="size-4 text-destructive" />
                  ) : (
                    <Loader2Icon className="size-4 text-muted-foreground" />
                  )}
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="truncate font-medium">
                      {a.name}
                      {a.version_number > 1 ? (
                        <span className="text-muted-foreground"> · v{a.version_number}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.status === "failed"
                        ? `Upload failed${a.upload_error ? `: ${a.upload_error}` : ""}`
                        : mine
                          ? `Upload in progress or interrupted · started ${formatRelativeTime(a.created_at)}`
                          : `${nameOf(a.uploaded_by)} is uploading · started ${formatRelativeTime(a.created_at)}`}
                    </p>
                  </div>
                  {mine ? (
                    <div className="flex gap-1">
                      <ResumeUploadButton assetId={a.id} name={a.name} size={a.size_bytes} />
                      <ConfirmAction
                        title="Remove this unfinished upload?"
                        description="Anything already uploaded for it is deleted from storage."
                        confirmLabel="Remove"
                        action={cancelAssetUpload.bind(null, a.id)}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove unfinished upload ${a.name}`}>
                            <XIcon />
                          </Button>
                        }
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState
            icon={FilesIcon}
            title="No files yet"
            description="Upload cuts, stills, audio or PDFs to review them with your team."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Project files">
            {groups.map(({ rootId, latest, versions }) => {
              const url = thumbUrl(latest.thumbnail_path);
              const open = openCount(rootId);
              return (
                <li
                  key={rootId}
                  className="overflow-hidden rounded-xl border bg-card shadow-xs"
                  data-asset-id={latest.id}
                >
                  <Link
                    href={`/app/projects/${projectId}/assets/${latest.id}`}
                    className="relative flex aspect-video items-center justify-center bg-muted"
                    aria-label={`Review ${latest.name}`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
                      <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <AssetKindIcon kind={latest.kind} className="size-8 text-muted-foreground" />
                    )}
                    {latest.duration_seconds ? (
                      <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
                        {formatTimecode(Number(latest.duration_seconds))}
                      </span>
                    ) : null}
                  </Link>
                  <div className="grid gap-1.5 p-3">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/app/projects/${projectId}/assets/${latest.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                        title={latest.name}
                      >
                        {latest.name}
                      </Link>
                      <AssetCardMenu
                        rootId={rootId}
                        name={latest.name}
                        versionCount={versions.length + unfinished.filter((u) => u.root_asset_id === rootId).length}
                        canDelete={canManage || allUploadedBy(rootId, currentUserId)}
                        archived={archived}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={versions.length > 1 ? "brand" : "secondary"}>v{latest.version_number}</Badge>
                      {versions.some((v) => pendingIds.has(v.id)) ? (
                        <Badge variant="warning">Awaiting approval</Badge>
                      ) : sharedIds.has(latest.id) ? (
                        <Badge variant="outline">Shared</Badge>
                      ) : null}
                      <span>{formatBytes(latest.size_bytes)}</span>
                      <span>· {formatRelativeTime(latest.created_at)}</span>
                      <span className="ml-auto inline-flex items-center gap-1" title={`${open} open comments`}>
                        <MessageSquareIcon className="size-3.5" />
                        {open}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </UploadQueueProvider>
  );
}
