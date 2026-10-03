import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `npm run test:ai-live`: one real request to the provider named by
 * AI_PROVIDER (set explicitly, in the shell or .env.local) and no other
 * (src/lib/ai/ai.live.test.ts). Gemini uses free-tier quota; Anthropic costs
 * a few cents. Never part of `npm run check` or CI.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: { include: ["src/**/*.live.test.ts"], environment: "node", testTimeout: 300_000 },
});
