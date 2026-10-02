"use client";

import { useRef } from "react";
import { RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/lib/media/file-types";
import { useUploadQueue } from "./upload-queue";

/**
 * Resumes an interrupted upload (e.g. after the tab was closed). The browser
 * no longer has the file, so the user picks it again; it must be the same size.
 */
export function ResumeUploadButton({ assetId, name, size }: { assetId: string; name: string; size: number }) {
  const { enqueue, items } = useUploadQueue();
  const input = useRef<HTMLInputElement>(null);
  const inQueue = items.some((i) => i.assetId === assetId && i.phase !== "cancelled");
  if (inQueue) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        <RotateCwIcon /> Resume
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        aria-label={`Choose ${name} again to resume the upload`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size !== size) {
            toast.error(
              `That file is ${formatBytes(file.size)}; the interrupted upload was ${formatBytes(size)}. Choose the same file.`,
            );
            return;
          }
          enqueue([file], { resumeAssetId: assetId });
        }}
      />
    </>
  );
}
