import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Pure-logic tests only — pass an inline (empty) PostCSS config so Vite doesn't try to load
// the project's postcss.config.mjs (which pulls in @tailwindcss/postcss; irrelevant here).
export default defineConfig({
  css: { postcss: { plugins: [] } },
  // Mirror tsconfig.json's `"paths": { "@/*": ["./*"] }` so tests can use the
  // same `@/lib/...` imports the application code does. Without this, lib
  // modules that depend on a sibling via @/ (e.g. scan-jobs.ts pulling
  // rate-limit) fail to import under vitest.
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
