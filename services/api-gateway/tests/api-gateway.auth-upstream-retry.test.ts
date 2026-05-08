/**
 * Forces `ensureAuthUpstreamBackground` retry loop (verify fails then succeeds) when
 * `GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY` is unset. Vitest config sets SKIP by default; this file
 * clears it only for the re-imported module.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

let verifyCalls = 0;

vi.mock("@common/utils/grpc-clients", () => ({
  createAuthClient: vi.fn(() => ({})),
  promisifyGrpcCall: vi.fn().mockRejectedValue(new Error("grpc unused in this suite")),
  verifyAuthGrpcUpstreamWithRetry: vi.fn(async () => {
    verifyCalls += 1;
    if (verifyCalls < 2) throw new Error("auth upstream not ready");
  }),
}));

describe("ensureAuthUpstreamBackground retries", () => {
  beforeAll(async () => {
    verifyCalls = 0;
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY = "0";
    process.env.GATEWAY_AUTH_VERIFY_RETRY_INITIAL_MS = "1";
    process.env.GATEWAY_AUTH_VERIFY_RETRY_MAX_MS = "20";
    process.env.VITEST = "true";
    vi.resetModules();
    await import("../src/server.js");
    const deadline = Date.now() + 15_000;
    while (verifyCalls < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  it("verifyAuthGrpcUpstreamWithRetry was retried until success", () => {
    expect(verifyCalls).toBeGreaterThanOrEqual(2);
  });

  afterAll(() => {
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY = "1";
  });
});
