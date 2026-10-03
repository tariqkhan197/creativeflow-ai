import "server-only";

import { serverEnv } from "@/lib/env/server";

/**
 * Model used when ANTHROPIC_MODEL isn't set: Claude Sonnet 5.5, verified
 * against Anthropic's models overview (pinned API ID `claude-sonnet-5-5`,
 * $2 / $10 per million input / output tokens). Override with ANTHROPIC_MODEL.
 */
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

/** Anthropic model IDs: "claude-" followed by lowercase letters, digits, dots and dashes. */
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{1,80}$/;

export type AiConfig =
  | { configured: true; apiKey: string; model: string }
  | { configured: false; reason: "missing_api_key" | "missing_secret_key" | "invalid_model"; message: string };

/**
 * Server-side AI settings. Never import this from a Client Component (the
 * `server-only` marker makes the build fail if you do), and never return the
 * key to callers outside src/lib/ai.
 */
export function getAiConfig(): AiConfig {
  if (!serverEnv.anthropicApiKey) {
    return {
      configured: false,
      reason: "missing_api_key",
      message: "AI Studio isn't set up yet: ANTHROPIC_API_KEY is missing on the server.",
    };
  }
  if (!serverEnv.supabaseSecretKey) {
    return {
      configured: false,
      reason: "missing_secret_key",
      message: "AI Studio isn't set up yet: SUPABASE_SECRET_KEY is missing on the server (it records AI results).",
    };
  }
  const model = serverEnv.anthropicModel ?? DEFAULT_AI_MODEL;
  if (!MODEL_ID.test(model)) {
    return {
      configured: false,
      reason: "invalid_model",
      message: "AI Studio isn't set up correctly: ANTHROPIC_MODEL isn't a valid Anthropic model ID.",
    };
  }
  return { configured: true, apiKey: serverEnv.anthropicApiKey, model };
}

/** Whether AI Studio can run, without exposing anything else (safe for UI). */
export function isAiConfigured(): boolean {
  return getAiConfig().configured;
}
