/**
 * Pragmatic Vitest v8 coverage excludes (Option 2 — meaningful runtime code).
 * Policy: docs/coverage-scope-policy.md
 *
 * - Thin process entrypoints (`src/server.ts`, `src/index.ts`) and OTEL bootstrap
 *   are excluded from coverage means (not from tests — they still run in prod).
 * - api-gateway `src/server.ts` is NOT excluded (logic-heavy router/proxy).
 * - Dev-only / lab glue under `src/` (e2e shims, trace debug, watchdog) excluded.
 */
export const baseCoverageExcludes = [
  "**/generated/**",
  "**/*.d.ts",
  "**/node_modules/**",
  "**/dist/**",
  "**/vitest.config.ts",
  "tests/**/*.integration.test.ts",
  "tests/auto/**",
] as const;

/** Applied to every housing service Vitest `coverage.exclude`. */
export const pragmaticProcessAndDevGlueExcludes = [
  "src/index.ts",
  "src/server.ts",
  "src/otel-bootstrap.ts",
  "**/pm2.config.cjs",
  "src/**/e2e-*.ts",
  "**/*debug-handler*.ts",
  "**/watchdog*.ts",
] as const;

export type HousingServiceVitestKind = "default" | "api-gateway";

export function coverageExcludeForHousingService(kind: HousingServiceVitestKind): string[] {
  const thin =
    kind === "api-gateway"
      ? pragmaticProcessAndDevGlueExcludes.filter((p) => p !== "src/server.ts")
      : [...pragmaticProcessAndDevGlueExcludes];
  return [...baseCoverageExcludes, ...thin];
}
