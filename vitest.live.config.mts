import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `npm run test:ai-live`: one real request to the provider selected by
 * AI_PROVIDER in .env.local (Gemini by default: uses free-tier quota;
 * Anthropic: costs a few cents). Never part of `npm run check` or CI.
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
