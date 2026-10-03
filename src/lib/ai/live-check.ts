import "server-only";

import type { StructuredResult } from "./anthropic";
import { ANTHROPIC_MODEL_ID, DEFAULT_AI_MODEL, GEMINI_MODEL_ID, type AiProvider } from "./config";
import { toAiFailure } from "./errors";
import { buildScriptUserMessage, SCRIPT_SYSTEM_PROMPT } from "./prompts";
import { scriptOutputSchema, type ScriptOutput } from "./script-schema";

/**
 * The opt-in live check (`npm run test:ai-live`): one real request to the
 * provider named by AI_PROVIDER, and only that provider. Used by
 * src/lib/ai/ai.live.test.ts; the selection and dispatch are unit-tested in
 * live-check.test.ts. Messages name settings, never their values.
 */

export type LiveTarget = { provider: AiProvider; apiKey: string; model: string };
export type LiveTargetResult = { ok: true; target: LiveTarget } | { ok: false; message: string };

const LABELS: Record<AiProvider, string> = { gemini: "Gemini", anthropic: "Anthropic" };
const value = (env: Record<string, string | undefined>, name: string) => env[name]?.trim() || undefined;

/**
 * Chooses the provider for the live check from the environment. AI_PROVIDER
 * must be set explicitly (the check makes a real request, so nothing is
 * assumed), and the chosen provider's settings must be present and valid.
 */
export function resolveLiveTarget(env: Record<string, string | undefined>): LiveTargetResult {
  const raw = value(env, "AI_PROVIDER");
  if (!raw) {
    return {
      ok: false,
      message:
        'AI_PROVIDER isn\'t set. Set it to "gemini" or "anthropic" (in .env.local or the shell) to choose which provider the live test calls.',
    };
  }
  const provider = raw.toLowerCase();
  if (provider !== "gemini" && provider !== "anthropic") {
    return { ok: false, message: 'AI_PROVIDER must be "gemini" or "anthropic".' };
  }

  if (provider === "gemini") {
    const apiKey = value(env, "GEMINI_API_KEY");
    const model = value(env, "GEMINI_MODEL");
    const missing = [!apiKey && "GEMINI_API_KEY", !model && "GEMINI_MODEL"].filter(Boolean);
    if (!apiKey || !model) {
      const verb = missing.length > 1 ? "aren't" : "isn't";
      return { ok: false, message: `AI_PROVIDER is "gemini" but ${missing.join(" and ")} ${verb} set.` };
    }
    if (!GEMINI_MODEL_ID.test(model)) {
      return { ok: false, message: 'GEMINI_MODEL isn\'t a valid Gemini model code (it should start with "gemini-").' };
    }
    return { ok: true, target: { provider, apiKey, model } };
  }

  const apiKey = value(env, "ANTHROPIC_API_KEY");
  if (!apiKey) return { ok: false, message: 'AI_PROVIDER is "anthropic" but ANTHROPIC_API_KEY isn\'t set.' };
  const model = value(env, "ANTHROPIC_MODEL") ?? DEFAULT_AI_MODEL;
  if (!ANTHROPIC_MODEL_ID.test(model)) {
    return { ok: false, message: "ANTHROPIC_MODEL isn't a valid Anthropic model ID." };
  }
  return { ok: true, target: { provider, apiKey, model } };
}

type LiveRequest = { model: string; system: string; user: string; maxTokens: number };
type Generate = (request: LiveRequest) => Promise<StructuredResult<ScriptOutput>>;

/** Creates a client for one provider. Each loads its SDK only when it is chosen. */
export type LiveDeps = Record<AiProvider, (apiKey: string) => Promise<Generate>>;

export const realLiveDeps: LiveDeps = {
  gemini: async (apiKey) => {
    const { createGeminiModels, generateStructuredGemini } = await import("./gemini");
    const models = createGeminiModels(apiKey);
    return (request) => generateStructuredGemini(models, { ...request, schema: scriptOutputSchema });
  },
  anthropic: async (apiKey) => {
    const { createAnthropicMessages, generateStructured } = await import("./anthropic");
    const messages = createAnthropicMessages(apiKey);
    return (request) => generateStructured(messages, { ...request, schema: scriptOutputSchema, effort: "medium" });
  },
};

/**
 * Sends one small script request (a 10-second teaser) to the target's
 * provider. Failures are rethrown with the same safe message the app shows.
 */
export async function runLiveCheck(
  target: LiveTarget,
  deps: LiveDeps = realLiveDeps,
): Promise<StructuredResult<ScriptOutput>> {
  const generate = await deps[target.provider](target.apiKey);
  try {
    return await generate({
      model: target.model,
      system: SCRIPT_SYSTEM_PROMPT,
      user: buildScriptUserMessage({
        brief: "A 10-second social teaser announcing a neighbourhood bakery's new sourdough loaf.",
        durationSeconds: 10,
        tone: "Warm",
        callToAction: "Visit this weekend",
      }),
      maxTokens: 16_000,
    });
  } catch (error) {
    const failure = toAiFailure(error);
    throw new Error(`Live ${LABELS[target.provider]} request failed (${failure.code}): ${failure.message}`);
  }
}
