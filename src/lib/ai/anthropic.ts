import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AiResponseError } from "./errors";

/**
 * Per-request limits. A script is a few thousand tokens; 16,000 leaves room
 * for adaptive thinking while staying a non-streaming request. One retry
 * (the SDK retries 408/409/429/5xx and connection errors) keeps the
 * worst case inside the server function's time limit.
 */
const REQUEST_TIMEOUT_MS = 150_000;
const MAX_RETRIES = 1;
export const SCRIPT_MAX_TOKENS = 16_000;

export type AiUsage = { inputTokens: number; outputTokens: number };
export type StructuredResult<T> = { data: T; model: string; usage: AiUsage };

/** The part of the SDK client this module uses (lets tests supply a stand-in). */
export type MessagesParser = Pick<Anthropic["messages"], "parse">;

export function createAnthropicMessages(apiKey: string): MessagesParser {
  // The key is passed explicitly (never read from a profile) and stays in this server module.
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES }).messages;
}

/**
 * One structured-output request: the model must answer with JSON matching
 * `schema` (Claude structured outputs), which is then validated again here.
 * Thinking is adaptive (the model's default); `effort` sets how hard it works.
 * Refusal fallbacks are deliberately not enabled (decision D5).
 */
export async function generateStructured<S extends z.ZodType>(
  messages: MessagesParser,
  request: {
    model: string;
    system: string;
    user: string;
    schema: S;
    maxTokens: number;
    effort: "low" | "medium" | "high";
  },
): Promise<StructuredResult<z.infer<S>>> {
  const response = await messages.parse({
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
  });

  if (response.stop_reason === "refusal") {
    throw new AiResponseError(
      "refused",
      "The AI declined this request. Try rewording the brief, and avoid content that could be harmful.",
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiResponseError("truncated", "The AI's answer was too long and got cut off. Try a shorter duration.");
  }
  const checked = request.schema.safeParse(response.parsed_output);
  if (response.parsed_output === null || !checked.success) {
    throw new AiResponseError("invalid_output", "The AI returned an answer in an unexpected format. Please try again.");
  }
  return {
    data: checked.data,
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
