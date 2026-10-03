// Test harness: mounts the real AI Studio brief form and script editor.
import { createRoot } from "react-dom/client";
import { ScriptBriefForm } from "@/components/ai/script-brief-form";
import { ScriptEditor } from "@/components/ai/script-editor";
import type { ScriptOutput } from "@/lib/ai/script-schema";

type W = Window & {
  mountAiBrief?: (disabledReason: string | null) => void;
  mountAiEditor?: (canEdit: boolean) => void;
};
const w = window as W;

const script: ScriptOutput = {
  title: "First steps",
  logline: "A nervous beginner finds their stride.",
  totalSeconds: 30,
  scenes: [
    {
      heading: "Dawn doubts",
      seconds: 10,
      visuals: "Runner laces up in a dim hallway.",
      voiceover: "Everyone starts somewhere.",
      dialogue: [],
      onScreenText: null,
      audio: "Soft piano",
    },
    {
      heading: "The first mile",
      seconds: 20,
      visuals: "Wide shot of an empty park path at sunrise.",
      voiceover: null,
      dialogue: [{ speaker: "Coach", line: "Just one more lamp post." }],
      onScreenText: "Find your first pair",
      audio: null,
    },
  ],
};

w.mountAiBrief = (disabledReason) => {
  createRoot(document.getElementById("root")!).render(
    <div style={{ width: 900 }}>
      <ScriptBriefForm
        projects={[{ id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", name: "Spring launch" }]}
        defaults={{
          title: "",
          projectId: "",
          brief: "",
          durationSeconds: "30",
          audience: "",
          tone: "",
          platform: "",
          callToAction: "",
        }}
        disabledReason={disabledReason}
        dataNote="The brief is sent to Google (Gemini API, free tier) to write the script."
      />
    </div>,
  );
};

w.mountAiEditor = (canEdit) => {
  createRoot(document.getElementById("root")!).render(
    <div style={{ width: 900 }}>
      <ScriptEditor generationId="0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d" script={script} canEdit={canEdit} />
    </div>,
  );
};
