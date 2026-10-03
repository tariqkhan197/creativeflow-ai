import { describe, expect, it, vi } from "vitest";
import { AiResponseError } from "./errors";
import { generateStructuredGemini, geminiResponseSchema, type GeminiModels } from "./gemini";
import { scriptOutputSchema } from "./script-schema";
import { validScript } from "./test-fixtures";

/** Test stand-in for the SDK's models.generateContent (the real API is never called in unit tests). */
function fakeModels(response: Record<string, unknown>) {
  const generateContent = vi.fn(async () => response);
  return { models: { generateContent } as unknown as GeminiModels, generateContent };
}
const request = {
  model: "gemini-test-flash",
  system: "system",
  user: "user",
  schema: scriptOutputSchema,
  maxTokens: 16000,
};
const ok = {
  candidates: [{ finishReason: "STOP" }],
  text: JSON.stringify(validScript),
  modelVersion: "gemini-test-flash-001",
  usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 1900, thoughtsTokenCount: 400 },
};

describe("generateStructuredGemini", () => {
  it("sends one JSON-schema request and returns the validated data, model and usage", async () => {
    const { models, generateContent } = fakeModels(ok);
    await expect(generateStructuredGemini(models, request)).resolves.toEqual({
      data: validScript,
      model: "gemini-test-flash-001",
      usage: { inputTokens: 700, outputTokens: 2300 },
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const params = (generateContent.mock.calls[0] as unknown[])[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };
    expect(params.model).toBe("gemini-test-flash");
    expect(params.contents).toBe("user");
    expect(params.config).toMatchObject({
      systemInstruction: "system",
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      candidateCount: 1,
    });
    expect(params.config.responseJsonSchema).toEqual(geminiResponseSchema(scriptOutputSchema));
  });

  it("falls back to the requested model name when the response has no model version", async () => {
    const { models } = fakeModels({ ...ok, modelVersion: undefined, usageMetadata: undefined });
    await expect(generateStructuredGemini(models, request)).resolves.toMatchObject({
      model: "gemini-test-flash",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it.each([
    ["a blocked prompt", { ...ok, promptFeedback: { blockReason: "SAFETY" }, candidates: [] }, "refused"],
    ["a safety stop", { ...ok, candidates: [{ finishReason: "SAFETY" }] }, "refused"],
    ["prohibited content", { ...ok, candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }, "refused"],
    ["the token limit", { ...ok, candidates: [{ finishReason: "MAX_TOKENS" }] }, "truncated"],
    ["text that isn't JSON", { ...ok, text: "Here is your script:" }, "invalid_output"],
    ["JSON that breaks the schema", { ...ok, text: JSON.stringify({ ...validScript, scenes: [] }) }, "invalid_output"],
    ["no candidates", { ...ok, candidates: undefined }, "invalid_output"],
  ])("rejects %s", async (_label, response, code) => {
    const { models } = fakeModels(response);
    const error = await generateStructuredGemini(models, request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiResponseError);
    expect((error as AiResponseError).code).toBe(code);
  });
});

describe("geminiResponseSchema", () => {
  const keywordsIn = (node: unknown, found = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((n) => keywordsIn(n, found));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        found.add(k);
        // Property names are data, not keywords.
        if (k === "properties" && v && typeof v === "object") Object.values(v).forEach((n) => keywordsIn(n, found));
        else keywordsIn(v, found);
      }
    }
    return found;
  };

  it("uses only JSON Schema keywords the Gemini API supports", () => {
    const schema = geminiResponseSchema(scriptOutputSchema);
    const allowed = new Set([
      "type",
      "description",
      "items",
      "minItems",
      "maxItems",
      "minimum",
      "maximum",
      "anyOf",
      "properties",
      "additionalProperties",
      "required",
      "propertyOrdering",
    ]);
    expect([...keywordsIn(schema)].filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("keeps the shape, order and numeric limits, and turns length limits into guidance", () => {
    const schema = geminiResponseSchema(scriptOutputSchema) as {
      required: string[];
      propertyOrdering: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(schema.propertyOrdering).toEqual(["title", "logline", "totalSeconds", "scenes"]);
    expect(schema.required).toEqual(["title", "logline", "totalSeconds", "scenes"]);
    expect(schema.properties.title).toMatchObject({
      type: "string",
      description: "Must not be empty. At most 200 characters.",
    });
    expect(schema.properties.totalSeconds).toEqual({ type: "integer", minimum: 1, maximum: 900 });
    expect(schema.properties.scenes).toMatchObject({ type: "array", minItems: 1, maxItems: 40 });
    const scene = (schema.properties.scenes.items as { properties: Record<string, unknown> }).properties;
    expect(scene.voiceover).toMatchObject({ anyOf: [{ type: "string" }, { type: "null" }] });
  });
});
