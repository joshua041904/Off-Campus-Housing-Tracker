import { defineConfig } from "vitest/config";

process.env.POSTGRES_URL_ANALYTICS ??=
  "postgresql://postgres:postgres@127.0.0.1:5447/analytics";
process.env.ANALYTICS_SYNC_MODE ??= "0";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/generated/**",
        "**/*.d.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    env: {
      POSTGRES_URL_ANALYTICS: process.env.POSTGRES_URL_ANALYTICS!,
      ANALYTICS_SYNC_MODE: process.env.ANALYTICS_SYNC_MODE ?? "0",
    },
  },
});
