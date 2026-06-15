import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
