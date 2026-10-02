"use client";

import { useRef, useState } from "react";
import { UploadCloudIcon } from "lucide-react";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/lib/media/file-types";
import { cn } from "@/lib/utils";
import { useUploadQueue } from "./upload-queue";

export function UploadDropzone({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const { enqueue, limitBytes } = useUploadQueue();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (files: FileList | null) => {
    if (!files?.length || disabled) return;
    enqueue([...files]);
    if (input.current) input.current.value = "";
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
      className={cn(
        "grid justify-items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
        over ? "border-brand bg-brand/5" : "bg-muted/20",
        disabled && "opacity-60",
      )}
    >
      <UploadCloudIcon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">
        {disabled ? disabledReason : "Drag files here, or"}{" "}
        {!disabled ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="cursor-pointer text-brand hover:underline"
          >
            browse
          </button>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        Video, images, audio and PDF ·{" "}
        {limitBytes ? `up to ${formatBytes(limitBytes)} per file` : "file size limit set by your Supabase project"}
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        aria-label="Choose files to upload"
        disabled={disabled}
        onChange={(e) => add(e.target.files)}
      />
    </div>
  );
}
