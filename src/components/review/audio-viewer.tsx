"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MusicIcon, PauseIcon, PlayIcon } from "lucide-react";
import { formatPreciseTimecode, formatTimecode } from "@/lib/media/timecode";
import { resolveDuration } from "@/lib/media/duration";
import { isTypingTarget } from "./keyboard";
import { Timeline } from "./timeline";
import type { ReviewMarker, ViewerHandle } from "./types";

export function AudioViewer({
  ref,
  reloadToken = 0,
  src,
  name,
  knownDuration,
  markers,
  onTime,
  onRequestComment,
  onMediaError,
}: {
  ref?: React.Ref<ViewerHandle>;
  reloadToken?: number;
  src: string;
  name: string;
  knownDuration: number | null;
  markers: ReviewMarker[];
  onTime: (t: number) => void;
  onRequestComment: () => void;
  onMediaError: (code: number | null) => Promise<boolean>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const resumeAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);

  const seek = useCallback(
    (t: number) => {
      const a = audio.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(t, a.duration || duration || t));
      setTime(a.currentTime);
      onTime(a.currentTime);
    },
    [duration, onTime],
  );
  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);

  // Reload after a signed-URL refresh triggered by a load error.
  useEffect(() => {
    if (reloadToken > 0) audio.current?.load();
  }, [reloadToken]);

  useImperativeHandle(ref, () => ({
    seek,
    pause: () => audio.current?.pause(),
    currentTime: () => audio.current?.currentTime ?? 0,
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || !audio.current) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft" || e.key === "j") seek(audio.current.currentTime - (e.key === "j" ? 5 : 1));
      else if (e.key === "ArrowRight" || e.key === "l") seek(audio.current.currentTime + (e.key === "l" ? 5 : 1));
      else if (e.key === "c") {
        e.preventDefault();
        audio.current.pause();
        onRequestComment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRequestComment, seek, toggle]);

  return (
    <div className="grid gap-4 rounded-xl bg-black p-6 text-white">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-12 items-center justify-center rounded-lg bg-white/10">
          <MusicIcon className="size-6" />
        </span>
        <p className="min-w-0 flex-1 truncate font-medium">{name}</p>
      </div>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          const resume = resumeAt.current;
          resumeAt.current = null;
          void resolveDuration(a).then((d) => {
            if (d) setDuration(d);
            if (resume !== null) a.currentTime = resume;
          });
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime);
        }}
        onError={(e) => {
          resumeAt.current = e.currentTarget.currentTime;
          void onMediaError(e.currentTarget.error?.code ?? null);
        }}
      />
      <Timeline time={time} duration={duration} markers={markers} onSeek={seek} onMarker={(m) => seek(m.t)} />
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={toggle}
          className="cursor-pointer rounded p-1.5 hover:bg-white/10"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
        </button>
        <span className="font-mono text-xs tabular-nums">
          {formatPreciseTimecode(time)} <span className="text-white/60">/ {formatTimecode(duration)}</span>
        </span>
      </div>
    </div>
  );
}
