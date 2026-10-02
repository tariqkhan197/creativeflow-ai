"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { formatFrameTimecode, formatPreciseTimecode, formatTimecode, stepFrame } from "@/lib/media/timecode";
import { isPinVisible } from "@/lib/media/geometry";
import { resolveDuration } from "@/lib/media/duration";
import { isTypingTarget } from "./keyboard";
import { PinLayer } from "./pin-layer";
import { Timeline } from "./timeline";
import type { PinPick, ReviewMarker, ReviewPin, ViewerHandle } from "./types";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoViewer({
  ref,
  reloadToken = 0,
  src,
  fps,
  knownDuration,
  width,
  height,
  markers,
  pins,
  pickMode,
  draftPin,
  onPick,
  onPinClick,
  onTime,
  onRequestComment,
  onMediaError,
}: {
  ref?: React.Ref<ViewerHandle>;
  reloadToken?: number;
  src: string;
  fps: number | null;
  knownDuration: number | null;
  width: number | null;
  height: number | null;
  markers: ReviewMarker[];
  pins: ReviewPin[];
  pickMode: boolean;
  draftPin: PinPick | null;
  onPick: (p: PinPick) => void;
  onPinClick: (pin: ReviewPin) => void;
  onTime: (t: number) => void;
  onRequestComment: () => void;
  /** Return true if the source was refreshed and playback should be retried. */
  onMediaError: (code: number | null) => Promise<boolean>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const resumeAt = useRef<{ t: number; play: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [frameMode, setFrameMode] = useState(Boolean(fps));
  const [intrinsic, setIntrinsic] = useState<{ w?: number; h?: number }>({
    w: width ?? undefined,
    h: height ?? undefined,
  });

  const seek = useCallback(
    (t: number) => {
      const v = video.current;
      if (!v) return;
      const clamped = Math.max(0, Math.min(t, v.duration || duration || t));
      v.currentTime = clamped;
      setTime(clamped);
      onTime(clamped);
    },
    [duration, onTime],
  );

  // Reload after a signed-URL refresh triggered by a load error.
  useEffect(() => {
    if (reloadToken > 0) video.current?.load();
  }, [reloadToken]);

  useImperativeHandle(ref, () => ({
    seek,
    pause: () => video.current?.pause(),
    currentTime: () => video.current?.currentTime ?? 0,
  }));

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const v = video.current;
      if (!v) return;
      v.pause();
      seek(stepFrame(v.currentTime, dir, fps, v.duration || duration));
    },
    [duration, fps, seek],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = video.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          toggle();
          break;
        case "j":
          seek(v.currentTime - 5);
          break;
        case "l":
          seek(v.currentTime + 5);
          break;
        case "ArrowLeft":
        case ",":
          e.preventDefault();
          if (e.shiftKey) seek(v.currentTime - 1);
          else step(-1);
          break;
        case "ArrowRight":
        case ".":
          e.preventDefault();
          if (e.shiftKey) seek(v.currentTime + 1);
          else step(1);
          break;
        case "m":
          v.muted = !v.muted;
          setMuted(v.muted);
          break;
        case "f":
          void (document.fullscreenElement ? document.exitFullscreen() : wrapper.current?.requestFullscreen());
          break;
        case "c":
          e.preventDefault();
          v.pause();
          onRequestComment();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRequestComment, seek, step, toggle]);

  const visiblePins = playing ? [] : pins.filter((p) => isPinVisible(p.t, time));
  const clock = frameMode && fps ? formatFrameTimecode(time, fps) : formatPreciseTimecode(time);

  return (
    <div ref={wrapper} className="overflow-hidden rounded-xl bg-black">
      <div className="relative aspect-video">
        <video
          ref={video}
          src={src}
          className="size-full object-contain"
          playsInline
          preload="metadata"
          onClick={() => !pickMode && toggle()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setIntrinsic({ w: v.videoWidth, h: v.videoHeight });
            const resume = resumeAt.current;
            resumeAt.current = null;
            void resolveDuration(v).then((d) => {
              if (d) setDuration(d);
              if (resume) {
                v.currentTime = resume.t;
                if (resume.play) void v.play().catch(() => undefined);
              }
            });
          }}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime);
            onTime(e.currentTarget.currentTime);
          }}
          onError={(e) => {
            const v = e.currentTarget;
            resumeAt.current = { t: v.currentTime, play: !v.paused };
            void onMediaError(v.error?.code ?? null);
          }}
        />
        <PinLayer
          mediaWidth={intrinsic.w}
          mediaHeight={intrinsic.h}
          pins={visiblePins}
          pickMode={pickMode}
          draft={draftPin}
          onPick={onPick}
          onPinClick={onPinClick}
        />
      </div>
      <div className="grid gap-2 bg-gradient-to-t from-black to-black/80 px-3 pt-1 pb-3 text-white">
        <Timeline time={time} duration={duration} markers={markers} onSeek={seek} onMarker={(m) => seek(m.t)} />
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={toggle}
            className="cursor-pointer rounded p-1.5 hover:bg-white/10"
            aria-label={playing ? "Pause (K)" : "Play (K)"}
          >
            {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            className="cursor-pointer rounded p-1.5 hover:bg-white/10"
            aria-label="Previous frame (←)"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            className="cursor-pointer rounded p-1.5 hover:bg-white/10"
            aria-label="Next frame (→)"
          >
            <ChevronRightIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => fps && setFrameMode((m) => !m)}
            className="cursor-pointer rounded px-2 py-1 font-mono text-xs tabular-nums hover:bg-white/10"
            aria-label="Current position"
            title={fps ? `Click to switch timecode format · ${fps} fps` : "Frame rate unknown — frame steps use 1/30 s"}
          >
            {clock} <span className="text-white/60">/ {formatTimecode(duration)}</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <NativeSelect
              aria-label="Playback speed"
              value={String(rate)}
              onChange={(e) => {
                const r = Number(e.target.value);
                if (video.current) video.current.playbackRate = r;
              }}
              className="w-20 [&_select]:h-8 [&_select]:border-white/20 [&_select]:bg-white/10 [&_select]:text-xs [&_select]:text-white"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s} className="text-black">
                  {s}×
                </option>
              ))}
            </NativeSelect>
            <button
              type="button"
              onClick={() => {
                if (!video.current) return;
                video.current.muted = !video.current.muted;
                setMuted(video.current.muted);
              }}
              className="cursor-pointer rounded p-1.5 hover:bg-white/10"
              aria-label={muted ? "Unmute (M)" : "Mute (M)"}
            >
              {muted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() =>
                void (document.fullscreenElement ? document.exitFullscreen() : wrapper.current?.requestFullscreen())
              }
              className="cursor-pointer rounded p-1.5 hover:bg-white/10"
              aria-label="Fullscreen (F)"
            >
              <MaximizeIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
