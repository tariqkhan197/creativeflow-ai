// Test seam for tests/browser: stand-in for the AI Studio Server Actions
// (which need Next.js, Supabase and the Anthropic API). Inputs are checked
// with the real schemas so the form and editor states run in a plain browser.
// The real rules are covered by src/lib/ai/service.test.ts and scripts/test-db.mjs.
import type { ActionResult, FormState } from "@/lib/actions/types";
import { scriptBriefSchema } from "@/lib/ai/script-schema";
import { normalizeEditedScript } from "@/lib/ai/studio";

type W = Window & {
  __briefs?: Record<string, string>[];
  __finishGeneration?: () => void;
  __savedScripts?: unknown[];
};
const w = window as W;

export async function generateScriptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = Object.fromEntries(
    [...formData.entries()].filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const parsed = scriptBriefSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
    return { status: "error", message: "Check the highlighted fields.", fieldErrors, values };
  }
  (w.__briefs ??= []).push(values);
  // Held until the test releases it, so the in-progress state can be checked;
  // then reports a failed model run (the real action redirects on success).
  await new Promise<void>((resolve) => (w.__finishGeneration = resolve));
  return {
    status: "error",
    message: "The AI service is busy right now. Please try again in a minute.",
    values,
    data: { code: "overloaded", generationId: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d" },
  };
}

export async function saveScriptDocument(_generationId: string, script: unknown): Promise<ActionResult> {
  const checked = normalizeEditedScript(script);
  if (!checked.ok) return { ok: false, error: checked.errors.join(" · ") };
  (w.__savedScripts ??= []).push(checked.script);
  return { ok: true, message: "Script saved." };
}

export async function updateGenerationDetails(): Promise<FormState> {
  return { status: "error", message: "Not available in the browser test." };
}

export async function deleteGeneration(): Promise<ActionResult> {
  return { ok: false, error: "Not available in the browser test." };
}
