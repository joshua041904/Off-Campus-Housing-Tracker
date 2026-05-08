import { coverageExcludeForHousingService } from "../../infra/vitest-coverage-pragmatic-excludes";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /** Prisma/redis spies are process-wide; avoid cross-test / cross-file races */
    sequence: { concurrent: false },
    poolOptions: { threads: { maxThreads: 1, minThreads: 1 } },
    environment: "node",
    /** Stable local Redis (no `redis` hostname); override in shell if needed */
    env: {
      VITEST: "true",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380/0",
      /** Valid shape for Prisma after vi.resetModules(); never used when $queryRaw is mocked */
      POSTGRES_URL_AUTH:
        process.env.POSTGRES_URL_AUTH ??
        "postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=auth",
    },
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      /** Per-service ≥98% enforced at repo root: `pnpm run coverage:enforce-98` (manifest). */
      exclude: [...coverageExcludeForHousingService("default"), "tests/**/*.integration.test.ts"],
    },
  },
});
