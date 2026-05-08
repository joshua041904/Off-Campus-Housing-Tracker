import { describe, expect, it } from "vitest";

/**
 * `pnpm test:integration` runs `vitest run tests/integration`.
 * Default vitest exclude drops `*.integration.test.ts`; use this path so the glob is non-empty.
 */
describe("messaging-service integration smoke", () => {
  it("placeholder until Redis/Kafka-backed tests land", () => {
    expect(true).toBe(true);
  });
});
