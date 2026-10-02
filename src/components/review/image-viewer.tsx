"use client";

import { useState } from "react";
import { PinLayer } from "./pin-layer";
import type { PinPick, ReviewPin } from "./types";

export function ImageViewer({
  src,
  name,
  width,
  height,
  pins,
  pickMode,
  draftPin,
  onPick,
  onPinClick,
  onMediaError,
}: {
  src: string;
  name: string;
  width: number | null;
  height: number | null;
  pins: ReviewPin[];
  pickMode: boolean;
  draftPin: PinPick | null;
  onPick: (p: PinPick) => void;
  onPinClick: (pin: ReviewPin) => void;
  onMediaError: (code: number | null) => Promise<boolean>;
}) {
  const [size, setSize] = useState<{ w?: number; h?: number }>({ w: width ?? undefined, h: height ?? undefined });
  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={src}
        alt={name}
        className="size-full object-contain"
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => void onMediaError(null)}
      />
      <PinLayer
        mediaWidth={size.w}
        mediaHeight={size.h}
        pins={pins}
        pickMode={pickMode}
        draft={draftPin}
        onPick={onPick}
        onPinClick={onPinClick}
      />
    </div>
  );
}
