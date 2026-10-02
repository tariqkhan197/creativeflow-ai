"use client";

import { useCallback, useRef, useState } from "react";
import { ReviewViewer, type ViewerAsset } from "./review-viewer";
import type { PinPick, ReviewMarker, ReviewPin, ViewerHandle } from "./types";
import type { SignedMedia } from "./use-signed-media";

/**
 * Client shell for the review page: owns playback position and pin-placement
 * state, and lays out the viewer next to the side panel.
 */
export function ReviewWorkspace({
  asset,
  initialMedia,
  side,
  markers = [],
  pins = [],
}: {
  asset: ViewerAsset;
  initialMedia: SignedMedia | null;
  side: React.ReactNode;
  markers?: ReviewMarker[];
  pins?: ReviewPin[];
}) {
  const viewer = useRef<ViewerHandle>(null);
  const [, setTime] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [draftPin, setDraftPin] = useState<PinPick | null>(null);
  const onTime = useCallback((t: number) => setTime(t), []);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <ReviewViewer
        ref={viewer}
        asset={asset}
        initialMedia={initialMedia}
        markers={markers}
        pins={pins}
        pickMode={pickMode}
        draftPin={draftPin}
        onPick={(p) => {
          setDraftPin(p);
          setPickMode(false);
        }}
        onPinClick={(pin) => {
          if (pin.t !== null) viewer.current?.seek(pin.t);
        }}
        onTime={onTime}
        onRequestComment={() => undefined}
      />
      <aside className="grid content-start gap-4">{side}</aside>
    </div>
  );
}
