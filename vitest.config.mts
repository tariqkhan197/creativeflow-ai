import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; Next.js enforces it in real builds.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Live tests call real paid APIs; they only run via `npm run test:ai-live`.
    exclude: ["**/node_modules/**", "src/**/*.live.test.ts"],
    environment: "node",
  },
});
