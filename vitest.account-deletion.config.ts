import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/account-deletion.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
