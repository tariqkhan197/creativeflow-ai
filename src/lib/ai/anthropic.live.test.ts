/**
 * Live check against the real Anthropic API (npm run test:ai-live).
 * Uses ANTHROPIC_API_KEY and ANTHROPIC_MODEL from .env.local; costs a few
 * cents. Nothing is written to the database.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("Set ANTHROPIC_API_KEY in .env.local to run the live AI test.");
  }
});

describe("Anthropic (live)", () => {
  it("generates a schema-valid script with the configured model", async () => {
    const { createAnthropicMessages, generateStructured } = await import("./anthropic");
    const { DEFAULT_AI_MODEL } = await import("./config");
    const { buildScriptUserMessage, SCRIPT_SYSTEM_PROMPT } = await import("./prompts");
    const { scriptOutputSchema } = await import("./script-schema");

    const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_AI_MODEL;
    const result = await generateStructured(createAnthropicMessages(process.env.ANTHROPIC_API_KEY!.trim()), {
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
      effort: "medium",
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
