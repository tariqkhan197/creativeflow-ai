// Test harness: mounts the real ReviewWorkspace (viewer + comments panel),
// as staff or in client-portal mode with the real decision panel.
import { createRoot } from "react-dom/client";
import { DecisionPanel } from "@/components/portal/decision-panel";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import type { AssetKind } from "@/types/database";

type W = Window & {
  __me?: string;
  mountWorkspace?: (src: string, kind: AssetKind, mime: string, duration: number) => void;
  mountClientWorkspace?: (
    src: string,
    kind: AssetKind,
    mime: string,
    duration: number,
    downloadUrl: string | null,
  ) => void;
};
const w = window as W;

const asset = (kind: AssetKind, mime: string, duration: number) => ({
  id: "a",
  name: "clip",
  kind,
  mime_type: mime,
  duration_seconds: duration,
  width: null,
  height: null,
  frame_rate: 25,
});

w.mountWorkspace = (src, kind, mime, duration) => {
  w.__me = "me";
  createRoot(document.getElementById("root")!).render(
    <div style={{ width: 1200 }}>
      <ReviewWorkspace
        asset={asset(kind, mime, duration)}
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

w.mountClientWorkspace = (src, kind, mime, duration, downloadUrl) => {
  w.__me = "client";
  createRoot(document.getElementById("root")!).render(
    <div style={{ width: 1200 }}>
      <ReviewWorkspace
        asset={asset(kind, mime, duration)}
        initialMedia={{ url: src, downloadUrl, expiresAt: Date.now() + 3_600_000 }}
        initialComments={[]}
        people={[{ id: "client", name: "Pat Client" }]}
        currentUserId="client"
        canManage={false}
        clientMode
        unknownName="Acme reviewer"
        asideTop={
          <DecisionPanel
            pending={{
              id: "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60",
              title: "Launch cut v2",
              message: "Please check the end card",
              status: "pending",
              requestedBy: "Morgan Lee",
              dueDate: null,
              createdAt: new Date().toISOString(),
              decidedAt: null,
              decisionNote: null,
              decidedByMe: false,
            }}
            history={[]}
          />
        }
        side={null}
      />
    </div>,
  );
};
