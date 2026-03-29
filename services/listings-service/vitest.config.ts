import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /** Run via `pnpm run test:integration` so DB env is applied before `db.ts` loads (fresh process). */
    exclude: ["tests/**/*.integration.test.ts", "**/node_modules/**"],
  },
});
