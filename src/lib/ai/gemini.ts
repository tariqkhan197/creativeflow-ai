import "server-only";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { StructuredResult } from "./anthropic";
import { AiResponseError } from "./errors";

/**
 * Per-attempt timeout and retries. Only server errors (5xx) are retried, once:
 * retrying a 429 would spend more of the free-tier quota and still fail, so
 * quota and rate-limit errors are reported straight away (see errors.ts).
 * Two attempts of 140 s stay inside the page's 300 s function limit.
 */
const REQUEST_TIMEOUT_MS = 140_000;
const RETRY = { attempts: 2, initialDelay: 2, httpStatusCodes: [500, 502, 503, 504] };

/** The part of the SDK client this module uses (lets tests supply a stand-in). */
export type GeminiModels = Pick<GoogleGenAI["models"], "generateContent">;

export function createGeminiModels(apiKey: string): GeminiModels {
  // The key is passed explicitly (never read from the environment by the SDK)
  // and stays in this server module. Gemini Developer API only, not Vertex AI.
  return new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: RETRY },
  }).models;
}

/**
 * JSON Schema keywords the Gemini API accepts in `responseJsonSchema`
 * (from the SDK's GenerateContentConfig documentation). Anything else, such
 * as string lengths, is moved into the description as guidance; zod checks
 * every limit again after the response arrives.
 */
const SUPPORTED_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

const HINTS: Record<string, (v: unknown) => string> = {
  minLength: (v) => (v === 1 ? "Must not be empty." : `At least ${String(v)} characters.`),
  maxLength: (v) => `At most ${String(v)} characters.`,
};

function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]));
      // Keep the answer in the same field order as the schema.
      out.propertyOrdering = Object.keys(value);
    } else if (key === "$defs" && value && typeof value === "object") {
      out.$defs = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (SUPPORTED_KEYWORDS.has(key)) {
      out[key] = toGeminiSchema(value);
    } else if (HINTS[key]) {
      hints.push(HINTS[key](value));
    }
  }
  // JavaScript's safe-integer bounds that zod adds to integers aren't useful to the model.
  if (out.type === "integer") {
    if (out.minimum === Number.MIN_SAFE_INTEGER) delete out.minimum;
    if (out.maximum === Number.MAX_SAFE_INTEGER) delete out.maximum;
  }
  if (hints.length) out.description = [out.description, ...hints].filter(Boolean).join(" ");
  return out;
}

/** The JSON Schema sent to Gemini for a zod schema (exported for tests). */
export function geminiResponseSchema(schema: z.ZodType): unknown {
  return toGeminiSchema(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}

/** Finish reasons that mean the answer was blocked rather than completed. */
const BLOCKED_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
]);

const BLOCKED_MESSAGE =
  "The AI declined or blocked this request. Try rewording the brief, and avoid content that could be harmful.";

/**
 * One structured-output request to Gemini: the answer must be JSON matching
 * `schema` (responseJsonSchema) and is validated again with zod. Blocked,
 * truncated and malformed answers become AiResponseErrors. `effort` has no
 * Gemini equivalent here; the model's default thinking is used.
 */
export async function generateStructuredGemini<S extends z.ZodType>(
  models: GeminiModels,
  request: { model: string; system: string; user: string; schema: S; maxTokens: number },
): Promise<StructuredResult<z.infer<S>>> {
  const response = await models.generateContent({
    model: request.model,
    contents: request.user,
    config: {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens,
      responseMimeType: "application/json",
      responseJsonSchema: geminiResponseSchema(request.schema),
      candidateCount: 1,
    },
  });

  if (response.promptFeedback?.blockReason) throw new AiResponseError("refused", BLOCKED_MESSAGE);
  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && BLOCKED_FINISH.has(finish)) throw new AiResponseError("refused", BLOCKED_MESSAGE);
  if (finish === "MAX_TOKENS") {
    throw new AiResponseError("truncated", "The AI's answer was too long and got cut off. Try a shorter duration.");
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(response.text ?? "");
  } catch {
    parsed = null;
  }
  const checked = request.schema.safeParse(parsed);
  if (!candidate || parsed === null || !checked.success) {
    throw new AiResponseError("invalid_output", "The AI returned an answer in an unexpected format. Please try again.");
  }

  const usage = response.usageMetadata;
  return {
    data: checked.data,
    model: response.modelVersion || request.model,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking tokens are part of the output the model produced.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
  };
}
