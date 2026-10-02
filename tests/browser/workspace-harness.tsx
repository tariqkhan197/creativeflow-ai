// Test harness: mounts the real ReviewWorkspace (viewer + comments panel).
import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import type { AssetKind } from "@/types/database";

type W = Window & {
  __me?: string;
  mountWorkspace?: (src: string, kind: AssetKind, mime: string, duration: number) => void;
};
const w = window as W;

w.mountWorkspace = (src, kind, mime, duration) => {
  w.__me = "me";
  createRoot(document.getElementById("root")!).render(
    <div style={{ width: 1200 }}>
      <ReviewWorkspace
        asset={{
          id: "a",
          name: "clip",
          kind,
          mime_type: mime,
          duration_seconds: duration,
          width: null,
          height: null,
          frame_rate: 25,
        }}
        initialMedia={{ url: src, downloadUrl: src, expiresAt: Date.now() + 3_600_000 }}
        initialComments={[]}
        people={[{ id: "me", name: "Morgan Lee" }]}
        currentUserId="me"
        canManage
        side={null}
      />
    </div>,
  );
};
