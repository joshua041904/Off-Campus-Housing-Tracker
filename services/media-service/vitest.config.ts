import { coverageExcludeForHousingService } from '../../infra/vitest-coverage-pragmatic-excludes'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    /** Integration needs Postgres/S3 — run `pnpm run test:integration`; default `test`/`test:coverage` stay unit-only. */
    exclude: ['tests/**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./tests/setup/env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: './coverage',
      /** ≥98% enforced at repo root: `pnpm run coverage:enforce-98` (manifest). */
      exclude: [...coverageExcludeForHousingService('default'), 'tests/**/*.integration.test.ts'],
    },
  },
})
