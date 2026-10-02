import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteAsset } from "@/lib/actions/assets";
import { formatBytes } from "@/lib/media/file-types";
import { cn, formatRelativeTime } from "@/lib/utils";

export type VersionRow = {
  id: string;
  version_number: number;
  name: string;
  size_bytes: number;
  created_at: string;
  uploaded_by: string | null;
  root_asset_id: string | null;
};

/** Version list with links to switch versions and per-version deletion. */
export function VersionHistory({
  projectId,
  versions,
  currentId,
  nameOf,
  canDelete,
}: {
  projectId: string;
  versions: VersionRow[];
  currentId: string;
  nameOf: (id: string | null) => string;
  canDelete: (v: VersionRow) => boolean;
}) {
  const hasNewer = (v: VersionRow) => v.root_asset_id === null && versions.length > 1;
  return (
    <ol className="grid gap-1" aria-label="Version history">
      {versions.map((v) => {
        const current = v.id === currentId;
        return (
          <li
            key={v.id}
            className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", current && "bg-accent")}
          >
            <Badge variant={current ? "brand" : "secondary"}>v{v.version_number}</Badge>
            <Link
              href={`/app/projects/${projectId}/assets/${v.id}`}
              aria-current={current ? "page" : undefined}
              className="grid min-w-0 flex-1 hover:underline"
            >
              <span className="truncate">{v.name}</span>
              <span className="text-xs text-muted-foreground">
                {nameOf(v.uploaded_by)} · {formatRelativeTime(v.created_at)} · {formatBytes(v.size_bytes)}
              </span>
            </Link>
            {canDelete(v) && !hasNewer(v) ? (
              <ConfirmAction
                title={`Delete version ${v.version_number}?`}
                description="This version's file, thumbnail and review comments are deleted permanently. Other versions are kept."
                confirmLabel="Delete version"
                action={deleteAsset.bind(null, v.id, "version", current ? `/app/projects/${projectId}` : undefined)}
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete version ${v.version_number}`}>
                    <Trash2Icon />
                  </Button>
                }
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
