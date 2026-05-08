import { defineConfig } from "vitest/config";

/**
 * Jaeger / observability contract tests (no Kafka global setup).
 * Requires JAEGER_QUERY_BASE (or legacy JAEGER_URL) when not skipped.
 */
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    maxWorkers: 1,
    include: ["tests/observability/**/*.test.ts"],
    // Allow zero executed tests when JAEGER_QUERY_BASE is unset (local dev without Jaeger).
    passWithNoTests: true,
    testTimeout: 25_000,
  },
});
