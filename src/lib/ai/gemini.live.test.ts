/**
 * Live check against the real Gemini API (npm run test:ai-live), run when
 * AI_PROVIDER is "gemini" or unset. Uses GEMINI_API_KEY and GEMINI_MODEL from
 * .env.local and one request of the project's free-tier quota. Nothing is
 * written to the database.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const selected = (process.env.AI_PROVIDER?.trim().toLowerCase() || "gemini") === "gemini";

beforeAll(() => {
  if (!selected) return;
  if (!process.env.GEMINI_API_KEY?.trim() || !process.env.GEMINI_MODEL?.trim()) {
    throw new Error("Set GEMINI_API_KEY and GEMINI_MODEL in .env.local to run the live AI test.");
  }
});

describe.skipIf(!selected)("Gemini (live)", () => {
  it("generates a schema-valid script with the configured model", async () => {
    const { createGeminiModels, generateStructuredGemini } = await import("./gemini");
    const { toAiFailure } = await import("./errors");
    const { buildScriptUserMessage, SCRIPT_SYSTEM_PROMPT } = await import("./prompts");
    const { scriptOutputSchema } = await import("./script-schema");

    const model = process.env.GEMINI_MODEL!.trim();
    const result = await generateStructuredGemini(createGeminiModels(process.env.GEMINI_API_KEY!.trim()), {
      model,
      system: SCRIPT_SYSTEM_PROMPT,
      user: buildScriptUserMessage({
        brief: "A 10-second social teaser announcing a neighbourhood bakery's new sourdough loaf.",
        durationSeconds: 10,
        tone: "Warm",
        callToAction: "Visit this weekend",
      }),
      schema: scriptOutputSchema,
      maxTokens: 16_000,
    }).catch((error: unknown) => {
      // Show the same safe message the app would (quota, rate limit, key, model).
      const failure = toAiFailure(error);
      throw new Error(`Live Gemini request failed (${failure.code}): ${failure.message}`);
    });

    expect(result.model.startsWith(model)).toBe(true);
    expect(result.data.scenes.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    console.log(
      `Live AI check: ${result.model}, ${result.data.scenes.length} scenes, ${result.data.totalSeconds}s, ` +
        `${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens`,
    );
  });
});
