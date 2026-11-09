import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 20000,
    include: ["tests/unit.test.ts", "tests/integration.test.ts", "tests/e2e.test.ts", "tests/admin.test.ts"],
    exclude: ["tests/core.test.ts", "node_modules"],
  },
  resolve: {
    alias: {
      "@": path.resolve("."),
    },
  },
});
