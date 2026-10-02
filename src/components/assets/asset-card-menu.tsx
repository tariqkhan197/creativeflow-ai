"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2Icon, MoreHorizontalIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteAsset } from "@/lib/actions/assets";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/file-types";
import { useUploadQueue } from "./upload-queue";

/** Card actions: upload a new version (same kind) or delete the file with every version. */
export function AssetCardMenu({
  rootId,
  name,
  versionCount,
  canDelete,
  archived,
}: {
  rootId: string;
  name: string;
  versionCount: number;
  canDelete: boolean;
  archived: boolean;
}) {
  const { enqueue } = useUploadQueue();
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={archived} onSelect={() => input.current?.click()}>
            <UploadIcon /> Upload new version
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                <Trash2Icon className="text-destructive" /> Delete
                {versionCount > 1 ? ` (all ${versionCount} versions)` : ""}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        aria-label={`Choose a new version of ${name}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) enqueue([file], { rootAssetId: rootId, label: `New version of ${name}` });
        }}
      />
      <AlertDialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {versionCount > 1 ? `All ${versionCount} versions, ` : "The file, "}their thumbnails and every review
              comment are deleted permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAsset(rootId, "all");
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(result.message ?? "Deleted");
                    setConfirming(false);
                  }
                })
              }
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null} Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
