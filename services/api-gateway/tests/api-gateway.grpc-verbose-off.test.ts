/**
 * `verboseGrpcErrors` is false when NODE_ENV=production and GATEWAY_VERBOSE_GRPC_ERRORS is unset;
 * handleGrpcError must not attach `detail` / `grpcCode` to JSON bodies.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { vitestRouteHitAgent } from "./vitest-route-hit-agent.js";
import * as grpc from "@grpc/grpc-js";

const promisifyGrpcCall = vi.hoisted(() =>
  vi.fn(async (_c: unknown, method: string) => {
    if (method === "Register") {
      const e = new Error("boom") as Error & { code?: number; details?: string };
      e.code = grpc.status.INVALID_ARGUMENT;
      e.details = JSON.stringify({ code: "BAD", message: "bad input" });
      throw e;
    }
    throw new Error("unused");
  }),
);

vi.mock("@common/utils/grpc-clients", () => ({
  createAuthClient: vi.fn(() => ({})),
  promisifyGrpcCall,
  verifyAuthGrpcUpstreamWithRetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/gateway-redis.js", () => ({
  shouldUseNoopGatewayRedis: () => false,
  createGatewayRedis: () => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    eval: vi.fn().mockResolvedValue(1),
  }),
}));

describe("gRPC errors with verbose flags off (production NODE_ENV)", () => {
  let app: import("express").Express;
  let agent: ReturnType<typeof vitestRouteHitAgent>;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    delete process.env.GATEWAY_VERBOSE_GRPC_ERRORS;
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY = "1";
    vi.resetModules();
    const mod = await import("../src/server.js");
    app = mod.app;
    agent = vitestRouteHitAgent(app);
  });

  it("register error body omits detail and grpcCode", async () => {
    const res = await agent.post("/api/auth/register").send({ email: "a@a.com", password: "pw" });
    expect(res.status).toBe(400);
    expect(res.body?.detail).toBeUndefined();
    expect(res.body?.grpcCode).toBeUndefined();
    expect(res.body?.code).toBe("BAD");
  });
});
