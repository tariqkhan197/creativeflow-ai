// Test harness: mounts the real ReviewViewer for tests/browser/viewer.test.mjs.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewViewer } from "@/components/review/review-viewer";
import type { PinPick, ViewerHandle } from "@/components/review/types";
import type { AssetKind } from "@/types/database";

type HarnessWindow = Window & {
  __h?: { ref: React.RefObject<ViewerHandle | null>; setPick: (v: boolean) => void };
  __picked?: PinPick;
  __commentRequested?: boolean;
  __currentSrc?: string;
  __refreshes?: number;
  mount?: (src: string, kind: AssetKind, mime: string) => void;
};
const w = window as HarnessWindow;

function App({ src, kind, mime, expiresAt }: { src: string; kind: AssetKind; mime: string; expiresAt: number }) {
  const ref = useRef<ViewerHandle>(null);
  const [pick, setPick] = useState(false);
  const [draft, setDraft] = useState<PinPick | null>(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    w.__h = { ref, setPick };
  }, []);

  return (
    <div style={{ width: 800 }}>
      <ReviewViewer
        ref={ref}
        asset={{
          id: "a",
          name: "clip",
          kind,
          mime_type: mime,
          duration_seconds: null,
          width: null,
          height: null,
          frame_rate: 25,
        }}
        initialMedia={{ url: src, downloadUrl: `${src}#download`, expiresAt }}
        markers={[{ id: "m1", t: 1, resolved: false, label: "logo" }]}
        pins={[{ id: "p1", x: 0.5, y: 0.5, t: 1, resolved: false, label: "pin" }]}
        pickMode={pick}
        draftPin={draft}
        onPick={(p) => {
          setDraft(p);
          w.__picked = p;
          setPick(false);
        }}
        onPinClick={() => undefined}
        onTime={setTime}
        onRequestComment={() => {
          w.__commentRequested = true;
        }}
      />
      <div id="time">{time.toFixed(3)}</div>
    </div>
  );
}

w.mount = (src, kind, mime) =>
  createRoot(document.getElementById("root")!).render(
    <App src={src} kind={kind} mime={mime} expiresAt={Date.now() + 3_600_000} />,
  );
