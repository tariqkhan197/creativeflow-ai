/**
 * Live check (npm run test:ai-live): one real request to the provider chosen
 * by AI_PROVIDER, and no other. Settings come from the shell or .env.local
 * (shell values win). Gemini uses one request of the project's free quota;
 * Anthropic costs a few cents. Nothing is written to the database, and keys
 * are never printed.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveLiveTarget, runLiveCheck } from "./live-check";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const resolved = resolveLiveTarget(process.env);

describe("AI provider (live)", () => {
  it("generates a schema-valid script with the configured provider and model", async () => {
    if (!resolved.ok) throw new Error(`Live AI test not run: ${resolved.message}`);
    const { target } = resolved;
    console.log(`Live AI check: calling ${target.provider} (${target.model}) only.`);

    const result = await runLiveCheck(target);

    // The served model version can differ from the requested code (for example an alias); both are logged.
    expect(result.model).toBeTruthy();
    expect(result.data.scenes.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    console.log(
      `Live AI check passed: ${target.provider}, requested ${target.model}, served ${result.model}, ${result.data.scenes.length} scenes, ` +
        `${result.data.totalSeconds}s, ${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens`,
    );
  });
});
