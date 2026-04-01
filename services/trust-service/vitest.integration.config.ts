import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 25_000,
    hookTimeout: 25_000,
    env: {
      POSTGRES_URL_TRUST:
        process.env.POSTGRES_URL_TRUST ??
        "postgresql://postgres:postgres@127.0.0.1:5446/trust",
    },
  },
});
