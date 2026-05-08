import { coverageExcludeForHousingService } from "../../infra/vitest-coverage-pragmatic-excludes";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      ANALYTICS_LISTING_INTELLIGENCE_V2: "0",
    },
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      /** ≥98% enforced at repo root: `pnpm run coverage:enforce-98` (manifest). */
      exclude: [...coverageExcludeForHousingService("default"), "tests/**/*.integration.test.ts"],
    },
  },
});
