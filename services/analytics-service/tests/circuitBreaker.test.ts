import { describe, expect, it, vi } from "vitest";
import { withCircuitBreaker } from "../src/circuitBreaker.js";

describe("withCircuitBreaker", () => {
  it("returns fn result on success", async () => {
    await expect(withCircuitBreaker(async () => true)).resolves.toBe(true);
  });

  it("returns null when fn throws", async () => {
    await expect(
      withCircuitBreaker(async () => {
        throw new Error("x");
      }),
    ).resolves.toBeNull();
  });
});
