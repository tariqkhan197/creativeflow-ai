"use client";

import { formatTimecode, markerPercent } from "@/lib/media/timecode";
import { cn } from "@/lib/utils";
import type { ReviewMarker } from "./types";

/** Scrubber with comment markers. The range input keeps it keyboard- and screen-reader-accessible. */
export function Timeline({
  time,
  duration,
  markers,
  onSeek,
  onMarker,
}: {
  time: number;
  duration: number;
  markers: ReviewMarker[];
  onSeek: (t: number) => void;
  onMarker: (marker: ReviewMarker) => void;
}) {
  const pct = markerPercent(time, duration) ?? 0;
  return (
    <div className="relative h-6">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.001}
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
        aria-valuetext={formatTimecode(time)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      />
      {markers.map((m) => {
        const left = markerPercent(m.t, duration);
        if (left === null) return null;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onMarker(m)}
            title={`${formatTimecode(m.t)} · ${m.label}`}
            aria-label={`Comment at ${formatTimecode(m.t)}: ${m.label}`}
            className={cn(
              "absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-black/40 transition-transform hover:scale-125",
              m.resolved ? "bg-white/60" : "bg-warning",
            )}
            style={{ left: `${left}%` }}
          />
        );
      })}
    </div>
  );
}
