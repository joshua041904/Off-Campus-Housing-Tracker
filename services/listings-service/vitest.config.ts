import { coverageExcludeForHousingService } from "../../infra/vitest-coverage-pragmatic-excludes";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    /** Run via `pnpm run test:integration` so DB env is applied before `db.ts` loads (fresh process). */
    exclude: ["tests/**/*.integration.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      /** ≥98% enforced at repo root: `pnpm run coverage:enforce-98` (manifest). */
      exclude: [...coverageExcludeForHousingService("default"), "tests/**/*.integration.test.ts"],
    },
  },
});
