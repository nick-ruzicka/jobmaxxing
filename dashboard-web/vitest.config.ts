import { defineConfig } from "vitest/config";

// Pure-logic tests only — pass an inline (empty) PostCSS config so Vite doesn't try to load
// the project's postcss.config.mjs (which pulls in @tailwindcss/postcss; irrelevant here).
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
