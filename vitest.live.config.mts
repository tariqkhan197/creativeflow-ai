import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `npm run test:ai-live`: tests that call the real Anthropic API with the key
 * in .env.local. They cost real money (a few cents) and never run in
 * `npm run check` or CI.
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
