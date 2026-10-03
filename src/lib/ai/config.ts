import "server-only";

import { serverEnv } from "@/lib/env/server";

export type AiProvider = "gemini" | "anthropic";

/**
 * Provider used when AI_PROVIDER isn't set: Google Gemini, called with a
 * free-tier API key. Anthropic (paid) is used only when AI_PROVIDER is set to
 * "anthropic" explicitly; there is never a fallback from one provider or
 * model to another.
 */
export const DEFAULT_AI_PROVIDER: AiProvider = "gemini";

/**
 * Anthropic model used when ANTHROPIC_MODEL isn't set: Claude Sonnet 5.5,
 * verified against Anthropic's models overview (pinned API ID
 * `claude-sonnet-5-5`, $2 / $10 per million input / output tokens).
 */
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

/** Anthropic model IDs: "claude-" followed by lowercase letters, digits, dots and dashes. */
const ANTHROPIC_MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{1,80}$/;
/** Gemini model codes: "gemini-" followed by lowercase letters, digits, dots and dashes. */
const GEMINI_MODEL_ID = /^gemini-[a-z0-9][a-z0-9.-]{1,80}$/;

const PROVIDER_LABELS: Record<AiProvider, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude" };

/**
 * Shown under the brief form so people know where their text goes. The
 * Gemini API's unpaid (free) tier lets Google use prompts and responses to
 * improve its products, with human review; see docs/SETUP.md.
 */
const DATA_NOTES: Record<AiProvider, string> = {
  gemini:
    "The brief is sent to Google (Gemini API, free tier) to write the script. On the free tier Google may use prompts and responses to improve its products, and people may review them, so don't include confidential client details, passwords or personal data.",
  anthropic:
    "The brief is sent to Anthropic (Claude) to write the script. Don't include passwords or personal data you wouldn't share with a supplier.",
};

export type AiConfigProblem =
  "invalid_provider" | "missing_api_key" | "missing_secret_key" | "missing_model" | "invalid_model";

export type AiConfig =
  | { configured: true; provider: AiProvider; apiKey: string; model: string }
  | { configured: false; provider: AiProvider | null; reason: AiConfigProblem; message: string };

const notConfigured = (provider: AiProvider | null, reason: AiConfigProblem, message: string): AiConfig => ({
  configured: false,
  provider,
  reason,
  message,
});

function selectedProvider(): AiProvider | null {
  const value = (serverEnv.aiProvider ?? DEFAULT_AI_PROVIDER).toLowerCase();
  return value === "gemini" || value === "anthropic" ? value : null;
}

/**
 * Server-side AI settings. Never import this from a Client Component (the
 * `server-only` marker makes the build fail if you do), and never return the
 * key to callers outside src/lib/ai.
 */
export function getAiConfig(): AiConfig {
  const provider = selectedProvider();
  if (!provider) {
    return notConfigured(
      null,
      "invalid_provider",
      'AI Studio isn\'t set up correctly: AI_PROVIDER must be "gemini" or "anthropic".',
    );
  }

  const apiKey = provider === "gemini" ? serverEnv.geminiApiKey : serverEnv.anthropicApiKey;
  if (!apiKey) {
    const name = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    return notConfigured(provider, "missing_api_key", `AI Studio isn't set up yet: ${name} is missing on the server.`);
  }
  if (!serverEnv.supabaseSecretKey) {
    return notConfigured(
      provider,
      "missing_secret_key",
      "AI Studio isn't set up yet: SUPABASE_SECRET_KEY is missing on the server (it records AI results).",
    );
  }

  if (provider === "gemini") {
    // No built-in default: the operator chooses a model that has free-tier
    // quota for their project (docs/SETUP.md), so nothing paid is ever picked
    // implicitly.
    const model = serverEnv.geminiModel;
    if (!model) {
      return notConfigured(
        provider,
        "missing_model",
        "AI Studio isn't set up yet: GEMINI_MODEL is missing on the server (choose a free-tier Gemini model).",
      );
    }
    if (!GEMINI_MODEL_ID.test(model)) {
      return notConfigured(
        provider,
        "invalid_model",
        "AI Studio isn't set up correctly: GEMINI_MODEL isn't a valid Gemini model code.",
      );
    }
    return { configured: true, provider, apiKey, model };
  }

  const model = serverEnv.anthropicModel ?? DEFAULT_AI_MODEL;
  if (!ANTHROPIC_MODEL_ID.test(model)) {
    return notConfigured(
      provider,
      "invalid_model",
      "AI Studio isn't set up correctly: ANTHROPIC_MODEL isn't a valid Anthropic model ID.",
    );
  }
  return { configured: true, provider, apiKey, model };
}

/** Whether AI Studio can run, without exposing anything else (safe for UI). */
export function isAiConfigured(): boolean {
  return getAiConfig().configured;
}

/**
 * What the UI may show about the AI setup: whether it works, which provider
 * it uses, and (when it doesn't) which setting is missing. Never the key.
 */
export function getAiStatus(): {
  configured: boolean;
  providerLabel: string | null;
  dataNote: string | null;
  message: string | null;
} {
  const config = getAiConfig();
  return {
    configured: config.configured,
    providerLabel: config.provider ? PROVIDER_LABELS[config.provider] : null,
    dataNote: config.provider ? DATA_NOTES[config.provider] : null,
    message: config.configured ? null : config.message,
  };
}
