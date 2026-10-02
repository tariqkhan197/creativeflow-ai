"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangleIcon, DownloadIcon, ExternalLinkIcon, FileTextIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldAutoRefresh } from "@/lib/media/url-refresh";
import type { AssetKind } from "@/types/database";
import { AudioViewer } from "./audio-viewer";
import { ImageViewer } from "./image-viewer";
import type { PinPick, ReviewMarker, ReviewPin, ViewerHandle } from "./types";
import { useSignedMedia, type SignedMedia } from "./use-signed-media";
import { VideoViewer } from "./video-viewer";

export type ViewerAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  mime_type: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
};

type Problem = "unsupported" | "unavailable" | null;

/**
 * Picks the right viewer for the asset, keeps its signed URL fresh, and shows
 * honest states when the browser can't preview the format or the file can't
 * be loaded. Download always uses a fresh signed URL, and is hidden when the
 * server issued none (downloads turned off for the client).
 */
export function ReviewViewer({
  ref,
  asset,
  initialMedia,
  markers,
  pins,
  pickMode,
  draftPin,
  onPick,
  onPinClick,
  onTime,
  onRequestComment,
}: {
  ref?: React.Ref<ViewerHandle>;
  asset: ViewerAsset;
  initialMedia: SignedMedia | null;
  markers: ReviewMarker[];
  pins: ReviewPin[];
  pickMode: boolean;
  draftPin: PinPick | null;
  onPick: (p: PinPick) => void;
  onPinClick: (pin: ReviewPin) => void;
  onTime: (t: number) => void;
  onRequestComment: () => void;
}) {
  const { media, error, refresh } = useSignedMedia(asset.id, initialMedia);
  const [problem, setProblem] = useState<Problem>(null);
  const lastAutoRefresh = useRef<number | null>(null);
  // Bumped after an error-triggered refresh so the media element reloads even
  // if the new signed URL happens to equal the old one.
  const [reloadToken, setReloadToken] = useState(0);

  // A load error may just be an expired link: refresh once (per 30 s window),
  // and treat a repeat failure as real. Every refresh yields a new signed URL,
  // so "once per URL" would loop forever on a file that can't be decoded.
  const onMediaError = useCallback(
    async (code: number | null) => {
      if (media && shouldAutoRefresh(lastAutoRefresh.current)) {
        lastAutoRefresh.current = Date.now();
        const ok = await refresh();
        if (ok) {
          setReloadToken((n) => n + 1);
          return true;
        }
        setProblem("unavailable");
        return false;
      }
      // MEDIA_ERR_SRC_NOT_SUPPORTED (4) with a fresh link = the browser can't decode it.
      setProblem(code === 4 || code === null ? "unsupported" : "unavailable");
      return false;
    },
    [media, refresh],
  );

  const download = media?.downloadUrl ? (
    <Button asChild variant="outline" size="sm">
      <a href={media.downloadUrl} rel="noopener">
        <DownloadIcon /> Download
      </a>
    </Button>
  ) : null;

  if (!media || error) {
    return (
      <Notice
        icon={<AlertTriangleIcon className="size-6" />}
        title="This file couldn't be loaded"
        body={error ?? "Please try again."}
      >
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RotateCwIcon /> Retry
        </Button>
      </Notice>
    );
  }

  if (problem === "unsupported") {
    return (
      <Notice
        icon={<FileTextIcon className="size-6" />}
        title={
          download
            ? "This format cannot be previewed in the browser. Download to view."
            : "This format cannot be previewed in the browser."
        }
        body={`${asset.name} (${asset.mime_type}) is stored safely. Comments still work below.`}
      >
        {download}
      </Notice>
    );
  }
  if (problem === "unavailable") {
    return (
      <Notice
        icon={<AlertTriangleIcon className="size-6" />}
        title="This file couldn't be loaded"
        body="The secure link may have expired or the connection dropped."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            lastAutoRefresh.current = Date.now();
            if (await refresh()) {
              setReloadToken((n) => n + 1);
              setProblem(null);
            }
          }}
        >
          <RotateCwIcon /> Retry
        </Button>
        {download}
      </Notice>
    );
  }

  return (
    <div className="grid gap-2">
      {asset.kind === "video" ? (
        <VideoViewer
          ref={ref}
          reloadToken={reloadToken}
          src={media.url}
          fps={asset.frame_rate}
          knownDuration={asset.duration_seconds}
          width={asset.width}
          height={asset.height}
          markers={markers}
          pins={pins}
          pickMode={pickMode}
          draftPin={draftPin}
          onPick={onPick}
          onPinClick={onPinClick}
          onTime={onTime}
          onRequestComment={onRequestComment}
          onMediaError={onMediaError}
        />
      ) : asset.kind === "audio" ? (
        <AudioViewer
          ref={ref}
          reloadToken={reloadToken}
          src={media.url}
          name={asset.name}
          knownDuration={asset.duration_seconds}
          markers={markers}
          onTime={onTime}
          onRequestComment={onRequestComment}
          onMediaError={onMediaError}
        />
      ) : asset.kind === "image" ? (
        <ImageViewer
          key={reloadToken}
          src={media.url}
          name={asset.name}
          width={asset.width}
          height={asset.height}
          pins={pins}
          pickMode={pickMode}
          draftPin={draftPin}
          onPick={onPick}
          onPinClick={onPinClick}
          onMediaError={onMediaError}
        />
      ) : (
        <div className="grid gap-2">
          <iframe title={asset.name} src={media.url} className="h-[70vh] w-full rounded-xl border bg-muted" />
          <p className="text-xs text-muted-foreground">
            PDF not showing?{" "}
            <a
              href={media.url}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            >
              Open it in a new tab <ExternalLinkIcon className="size-3" />
            </a>
          </p>
        </div>
      )}
      <div className="flex justify-end">{download}</div>
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="grid aspect-video content-center justify-items-center gap-3 rounded-xl border bg-muted/40 p-6 text-center"
      role="status"
    >
      <span className="text-muted-foreground">{icon}</span>
      <p className="max-w-md font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
