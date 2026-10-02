"use client";

import { useEffect, useRef, useState } from "react";
import { containedRect, fromNormalizedPoint, toNormalizedPoint, type Rect } from "@/lib/media/geometry";
import { cn } from "@/lib/utils";
import type { PinPick, ReviewPin } from "./types";

/**
 * Overlay aligned with the displayed media frame (letterboxing excluded).
 * Shows comment pins and, in pick mode, turns a click into normalized x/y.
 */
export function PinLayer({
  mediaWidth,
  mediaHeight,
  pins,
  pickMode,
  draft,
  onPick,
  onPinClick,
}: {
  mediaWidth?: number;
  mediaHeight?: number;
  pins: ReviewPin[];
  pickMode: boolean;
  draft: PinPick | null;
  onPick: (p: PinPick) => void;
  onPinClick: (pin: ReviewPin) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Rect | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFrame(containedRect(el.clientWidth, el.clientHeight, mediaWidth, mediaHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mediaWidth, mediaHeight]);

  return (
    <div
      ref={box}
      className={cn("absolute inset-0", pickMode ? "cursor-crosshair" : "pointer-events-none")}
      onClick={(e) => {
        if (!pickMode || !frame || !box.current) return;
        const r = box.current.getBoundingClientRect();
        const p = toNormalizedPoint(e.clientX - r.left, e.clientY - r.top, frame);
        if (p) onPick(p);
      }}
      aria-hidden={!pickMode}
    >
      {frame
        ? pins.map((pin, i) => {
            const pos = fromNormalizedPoint(pin, frame);
            return (
              <button
                key={pin.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinClick(pin);
                }}
                title={pin.label}
                aria-label={`Pin: ${pin.label}`}
                className={cn(
                  "pointer-events-auto absolute flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold shadow-lg",
                  pin.resolved ? "bg-muted-foreground text-white" : "bg-brand text-brand-foreground",
                )}
                style={{ left: pos.left, top: pos.top }}
              >
                {i + 1}
              </button>
            );
          })
        : null}
      {frame && draft ? (
        <span
          className="absolute size-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-warning shadow-lg"
          style={fromNormalizedPoint(draft, frame)}
          aria-hidden
        />
      ) : null}
      {pickMode ? (
        <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
          Click the frame to place a pin
        </p>
      ) : null}
    </div>
  );
}
