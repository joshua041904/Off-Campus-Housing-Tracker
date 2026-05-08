/**
 * Route + branch exhaustion for gateway app (imports ../src/server with upstreams refused in vitest.config env).
 * gRPC paths mocked so register/login/validate/refresh do not need a real auth-service.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import { vitestRouteHitAgent } from "./vitest-route-hit-agent.js";
import * as grpc from "@grpc/grpc-js";

const promisifyGrpcCall = vi.hoisted(() =>
  vi.fn(async (_client: unknown, method: string, body: Record<string, unknown>) => {
    if (method === "Register") return { token: "tok", user: { id: "1", email: body.email } };
    if (method === "Authenticate") {
      if (body.email === "mfa@example.com") return { requires_mfa: true, user_id: "u1", message: "need mfa" };
      if (body.email === "mfa-alt@example.com") return { user_id: "u-alt", message: "need mfa alt" };
      if (body.email === "authfail@example.com") {
        const e = new Error("auth denied") as Error & { code?: number; details?: string };
        e.code = grpc.status.UNAUTHENTICATED;
        e.details = JSON.stringify({ code: "BAD_CREDS", message: "nope" });
        throw e;
      }
      return { token: "at", refresh_token: "rt", user: { id: "2" } };
    }
    if (method === "ValidateToken") {
      if (body.token === "grpc-validate-false") return { valid: false, user: null };
      if (body.token === "grpc-validate-throw") {
        const e = new Error("validate boom") as Error & { code?: number };
        e.code = grpc.status.INTERNAL;
        throw e;
      }
      return { valid: true, user: { id: "3" } };
    }
    if (method === "RefreshToken") {
      if (body.refresh_token === "empty-refresh") return {};
      return { token: "refreshed" };
    }
    const err: Error & { code?: number; details?: string } = new Error("grpc fail");
    err.code = grpc.status.UNAUTHENTICATED;
    err.details = JSON.stringify({ code: "AUTH_DENIED", message: "no" });
    throw err;
  }),
);

/** Spyable Redis `get` for JWT revocation branch in `server.ts` (this file only — does not affect gateway-redis.test.ts). */
const gatewayRedisGet = vi.hoisted(() => vi.fn(async (_key: string) => null as string | null));

vi.mock("@common/utils/grpc-clients", () => ({
  createAuthClient: vi.fn(() => ({})),
  promisifyGrpcCall,
  verifyAuthGrpcUpstreamWithRetry: vi.fn().mockResolvedValue(undefined),
}));

const verifyJwt = vi.hoisted(() =>
  vi.fn((token: string) => {
    if (token === "bad") throw new Error("invalid jwt");
    return { sub: "00000000-0000-4000-8000-000000000001", email: "u@e.com", jti: "jti-1" };
  }),
);

vi.mock("@common/utils/auth", () => ({
  verifyJwt,
}));

vi.mock("../src/gateway-redis.js", () => ({
  shouldUseNoopGatewayRedis: () => false,
  createGatewayRedis: () => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: gatewayRedisGet,
    set: vi.fn().mockResolvedValue(undefined),
    eval: vi.fn().mockResolvedValue(1),
  }),
}));

/** Wrap real proxy middleware so we can invoke `opts.on.error` for branch coverage (this file only). */
vi.mock("http-proxy-middleware", async (importOriginal) => {
  const orig = await importOriginal<typeof import("http-proxy-middleware")>();
  const realCreate = orig.createProxyMiddleware;
  return {
    ...orig,
    createProxyMiddleware: (opts: any) => {
      const inner = realCreate(opts);
      return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
        const code = req.get("x-test-force-proxy-error");
        if (code && opts?.on?.error) {
          if (code === "GENERIC") {
            opts.on.error(new Error("generic proxy failure"), req, res);
            return;
          }
          const err = new Error(`forced ${code}`) as NodeJS.ErrnoException;
          err.code = code;
          opts.on.error(err, req, res);
          return;
        }
        return inner(req, res, next);
      };
    },
  };
});

describe("api-gateway exhaustive HTTP", () => {
  let app: import("express").Express;
  let agent: ReturnType<typeof vitestRouteHitAgent>;
  let __testSetAuthUpstreamReady: (value: boolean) => void;

  beforeAll(async () => {
    process.env.NODE_ENV = "development";
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY = "1";
    process.env.GATEWAY_VERBOSE_GRPC_ERRORS = "1";
    gatewayRedisGet.mockReset();
    gatewayRedisGet.mockImplementation(async () => null);
    vi.resetModules();
    const mod = await import("../src/server");
    app = mod.app;
    agent = vitestRouteHitAgent(app);
    __testSetAuthUpstreamReady = mod.__testSetAuthUpstreamReady;
  });

  beforeEach(() => {
    gatewayRedisGet.mockReset();
    gatewayRedisGet.mockImplementation(async () => null);
  });

  it("GET /healthz /api/healthz /health /api/health /whoami /metrics", async () => {
    for (const path of ["/healthz", "/api/healthz", "/health", "/api/health", "/whoami"]) {
      const res = await agent.get(path);
      expect(res.status).toBe(200);
    }
    const m = await agent.get("/metrics");
    expect(m.status).toBe(200);
    expect(String(m.text)).toContain("#");
  });

  it("GET /readyz when auth verify skipped", async () => {
    const res = await agent.get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body?.authUpstream).toBe(true);
  });

  it("GET /readyz — 503 when auth upstream not ready, then 200 after test hook restores", async () => {
    __testSetAuthUpstreamReady(false);
    const down = await agent.get("/readyz");
    expect(down.status).toBe(503);
    expect(down.body?.ok).toBe(false);
    expect(down.body?.authUpstream).toBe(false);
    __testSetAuthUpstreamReady(true);
    const up = await agent.get("/readyz");
    expect(up.status).toBe(200);
    expect(up.body?.authUpstream).toBe(true);
  });

  it("GET /api/debug/full-trace returns 200 JSON envelope (upstream refused)", async () => {
    const res = await agent.get("/api/debug/full-trace");
    expect(res.status).toBe(200);
    expect(res.body?.trace).toBe("full");
    expect(Array.isArray(res.body?.services)).toBe(true);
    expect(res.body?.ok).toBe(false);
  });

  it("GET /api/debug/headers is reachable", async () => {
    const res = await agent.get("/api/debug/headers");
    expect(res.status).toBeLessThan(500);
  });

  it("POST /api/auth/register valid and invalid body", async () => {
    const bad = await agent.post("/api/auth/register").send({ email: "a@a.com" });
    expect(bad.status).toBe(400);

    const ok = await agent.post("/api/auth/register").send({ email: "a@a.com", password: "pw" });
    expect(ok.status).toBe(201);
    expect(ok.body?.token).toBeTruthy();
  });

  it("POST /api/auth/register — gRPC returns no token still 201 with empty token", async () => {
    (promisifyGrpcCall as Mock).mockResolvedValueOnce({ user: { id: "9" } });
    const res = await agent.post("/api/auth/register").send({ email: "notok@x.com", password: "pw" });
    expect(res.status).toBe(201);
    expect(res.body?.token).toBe("");
  });

  it("POST /auth/register — non-/api path hits same gRPC register", async () => {
    const res = await agent.post("/auth/register").send({ email: "path@x.com", password: "pw" });
    expect(res.status).toBe(201);
    expect(res.body?.token).toBeTruthy();
  });

  it("POST /api/auth/login MFA branch and success", async () => {
    const mfa = await agent.post("/api/auth/login").send({ email: "mfa@example.com", password: "pw" });
    expect(mfa.status).toBe(200);
    expect(mfa.body?.requiresMFA).toBe(true);

    const mfaAlt = await agent.post("/api/auth/login").send({ email: "mfa-alt@example.com", password: "pw" });
    expect(mfaAlt.status).toBe(200);
    expect(mfaAlt.body?.requiresMFA).toBe(true);

    const ok = await agent.post("/api/auth/login").send({ email: "a@a.com", password: "pw" });
    expect(ok.status).toBe(200);
    expect(ok.body?.token).toBeTruthy();
  });

  it("POST /api/auth/validate missing and present bearer", async () => {
    const miss = await agent.post("/api/auth/validate").send({});
    expect(miss.status).toBe(401);

    const ok = await agent.post("/api/auth/validate").set("Authorization", "Bearer good").send({});
    expect(ok.status).toBe(200);
  });

  it("POST /auth/validate — same handler as /api/auth/validate", async () => {
    const res = await agent.post("/auth/validate").set("Authorization", "Bearer good").send({});
    expect(res.status).toBe(200);
    expect(res.body?.valid).toBe(true);
  });

  it("POST /api/auth/validate — gRPC valid:false → 401", async () => {
    const res = await agent
      .post("/api/auth/validate")
      .set("Authorization", "Bearer grpc-validate-false")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body?.valid).toBe(false);
  });

  it("POST /api/auth/validate — gRPC throw maps through handleGrpcError", async () => {
    const res = await agent
      .post("/api/auth/validate")
      .set("Authorization", "Bearer grpc-validate-throw")
      .send({});
    expect(res.status).toBe(500);
  });

  it("POST /api/auth/refresh missing bearer", async () => {
    const res = await agent.post("/api/auth/refresh").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/refresh — gRPC returns no token → 401", async () => {
    const res = await agent
      .post("/api/auth/refresh")
      .set("Authorization", "Bearer empty-refresh")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_TOKEN");
  });

  it("POST /api/auth/login — gRPC UNAUTHENTICATED maps to client error", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ email: "authfail@example.com", password: "pw" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("protected route without token returns 401 (open route false, health bypass false)", async () => {
    const res = await agent.get("/api/listings/internal-only-probe");
    expect(res.status).toBe(401);
  });

  it("open routes reach proxy without JWT — 502 on refused upstream", async () => {
    const paths = [
      "/api/listings/search?q=open",
      "/listings/search?q=open",
      "/api/listings",
      "/listings",
      "/api/listings/listings/550e8400-e29b-41d4-a716-446655440000",
      "/api/listings/550e8400-e29b-41d4-a716-446655440000",
      "/api/trust/reputation/550e8400-e29b-41d4-a716-446655440000",
      "/api/analytics/daily-metrics",
    ];
    for (const p of paths) {
      const res = await agent.get(p);
      expect(res.status, p).toBe(502);
    }
    const postAnalyze = await agent
      .post("/api/analytics/insights/listing/550e8400-e29b-41d4-a716-446655440000/analyze")
      .send({});
    expect(postAnalyze.status).toBe(502);
    const postAnalyzeShort = await agent
      .post("/api/analytics/listing/550e8400-e29b-41d4-a716-446655440000/analyze")
      .send({});
    expect(postAnalyzeShort.status).toBe(502);
    const postFeelV2 = await agent.post("/api/analytics/v2/insights/listing-feel").send({});
    expect(postFeelV2.status).toBe(502);
    const postAnalyzeV2 = await agent
      .post("/api/analytics/v2/insights/listing/550e8400-e29b-41d4-a716-446655440000/analyze")
      .send({});
    expect(postAnalyzeV2.status).toBe(502);
    const postBareInsights = await agent.post("/insights/listing-feel").send({});
    expect(postBareInsights.status).toBe(502);
    const getBareInsights = await agent.get("/insights/listing-feel");
    expect(getBareInsights.status).toBe(405);
    expect(getBareInsights.headers.allow).toBe("POST");
    expect(getBareInsights.body).toMatchObject({
      error: "method_not_allowed",
      code: "POST_REQUIRED",
      ui: "/analytics",
    });
    const getAnalyzeBare = await agent.get(
      "/insights/listing/550e8400-e29b-41d4-a716-446655440000/analyze",
    );
    expect(getAnalyzeBare.status).toBe(405);
    expect(getAnalyzeBare.headers.allow).toBe("POST");
    const getFeelAsBrowser = await agent
      .get("/insights/listing-feel")
      .set("Sec-Fetch-Dest", "document")
      .set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
    expect(getFeelAsBrowser.status).toBe(303);
    expect(String(getFeelAsBrowser.headers.location || "")).toContain("/analytics");
  });

  it("GET healthz-style paths bypass JWT (isGetHealthzBypass) then proxy — upstream error", async () => {
    for (const p of ["/api/listings/healthz", "/api/booking/healthz", "/api/messaging/healthz"]) {
      const res = await agent.get(p);
      expect([502, 504], p).toContain(res.status);
    }
  });

  it("POST /api/listings/healthz is not a health bypass — requires JWT → 401", async () => {
    const res = await agent.post("/api/listings/healthz").send({});
    expect(res.status).toBe(401);
  });

  it("limiter skip — x-e2e-test on protected path still 401 (auth after limiter)", async () => {
    const res = await agent.get("/api/booking/x").set("x-e2e-test", "1");
    expect(res.status).toBe(401);
  });

  it("limiter skip — x-test-mode on protected path → 401", async () => {
    const res = await agent.get("/api/booking/y").set("X-Test-Mode", "1");
    expect(res.status).toBe(401);
  });

  it("limiter skip — x-loadtest on protected path → 401 without bearer", async () => {
    const res = await agent.get("/api/booking/z").set("x-loadtest", "1");
    expect(res.status).toBe(401);
  });

  it("GET /api/analytics/healthz without auth — limiter skip + open route → upstream error", async () => {
    const res = await agent.get("/api/analytics/healthz");
    expect([502, 504]).toContain(res.status);
  });

  it("trace middleware accepts valid client x-trace-id (regex branch)", async () => {
    const tid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const res = await agent.get("/healthz").set("X-Trace-Id", tid);
    expect(res.status).toBe(200);
    expect(res.headers["x-trace-id"]).toBe(tid);
  });

  it("protected proxy forwards traceparent / tracestate to upstream (proxyReq branch)", async () => {
    const res = await agent
      .get("/api/booking/x")
      .set("Authorization", "Bearer good")
      .set("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
      .set("tracestate", "x=y");
    expect(res.status).toBe(502);
  });

  it("protected route with bearer hits proxy and returns 502 on refused upstream", async () => {
    const res = await agent
      .get("/api/listings/search?q=test")
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(502);
    expect(res.body?.error).toBeTruthy();
  });

  it("protected /api/messaging proxy — 502 on refused upstream (forum path rewrite)", async () => {
    const res = await agent.get("/api/messages/healthz-not-real").set("Authorization", "Bearer good");
    expect([502, 504]).toContain(res.status);
  });

  it("JWT revocation branch — Redis hit returns TOKEN_REVOKED", async () => {
    gatewayRedisGet.mockImplementation(async (key: string) => {
      expect(key).toMatch(/^revoked:/);
      return "1";
    });
    const res = await agent.get("/api/booking/x").set("Authorization", "Bearer good");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("TOKEN_REVOKED");
  });

  it("JWT revocation branch — Redis get slow path times out and request proceeds", async () => {
    gatewayRedisGet.mockImplementation(
      () => new Promise<string | null>(() => {}),
    );
    const res = await agent.get("/api/listings/search?q=after-timeout").set("Authorization", "Bearer good");
    expect(res.status).toBe(502);
  });

  it("unknown /api segment returns 404 before auth", async () => {
    const res = await agent.get("/api/unknown-segment-xyz/foo");
    expect(res.status).toBe(404);
  });

  it("OPTIONS unknown /api segment passes 404 middleware (OPTIONS branch)", async () => {
    const res = await agent.options("/api/unknown-segment-xyz/foo");
    expect([204, 200, 404]).toContain(res.status);
  });

  it("GET /api returns 404", async () => {
    const res = await agent.get("/api");
    expect(res.status).toBe(404);
  });

  it("OPTIONS /api/listings/search passes guard chain", async () => {
    const res = await agent.options("/api/listings/search");
    expect([204, 200]).toContain(res.status);
  });

  it("malformed JSON returns 400", async () => {
    const res = await agent
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(res.status).toBe(400);
  });

  it("grpc error path uses parseGrpcErrorPayload when details is JSON", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({
      code: grpc.status.INVALID_ARGUMENT,
      message: "x",
      details: JSON.stringify({ code: "BAD", message: "bad input" }),
    });
    const res = await agent.post("/api/auth/register").send({ email: "x@x.com", password: "pw" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("BAD");
  });

  it("parseGrpcErrorPayload — invalid JSON in details uses fallback message", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({
      code: grpc.status.INVALID_ARGUMENT,
      message: "outer",
      details: "{ not json",
    });
    const res = await agent.post("/api/auth/register").send({ email: "badjson@x.com", password: "pw" });
    expect(res.status).toBe(400);
    expect(String(res.body?.message || "")).toBeTruthy();
  });

  it("parseGrpcErrorPayload — valid JSON but wrong shape returns UNKNOWN_ERROR body", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({
      code: grpc.status.INVALID_ARGUMENT,
      message: "m",
      details: JSON.stringify({ foo: 1 }),
    });
    const res = await agent.post("/api/auth/register").send({ email: "shape@x.com", password: "pw" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("UNKNOWN_ERROR");
  });

  it("parseGrpcErrorPayload — non-string details uses message fallback", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({
      code: grpc.status.INTERNAL,
      message: "grpc-msg-only",
      details: { not: "a string" } as unknown as string,
    });
    const res = await agent.post("/api/auth/register").send({ email: "nodetails@x.com", password: "pw" });
    expect(res.status).toBe(500);
    expect(String(res.body?.message || "")).toContain("grpc-msg-only");
  });

  it("handleGrpcError — INVALID_ARGUMENT without message uses grpc error fallback", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({ code: grpc.status.INVALID_ARGUMENT });
    const res = await agent.post("/api/auth/register").send({ email: "nomsg@x.com", password: "pw" });
    expect(res.status).toBe(400);
    expect(String(res.body?.message || "")).toMatch(/grpc/i);
  });

  it("handleGrpcError — no numeric grpc code skips grpcCode in verbose body", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({ message: "shapeless" });
    const res = await agent.post("/api/auth/register").send({ email: "nocode@x.com", password: "pw" });
    expect(res.status).toBe(500);
    expect(res.body?.grpcCode).toBeUndefined();
  });

  it("handleGrpcError logs metadata.getMap when present", async () => {
    (promisifyGrpcCall as Mock).mockRejectedValueOnce({
      code: grpc.status.PERMISSION_DENIED,
      message: "denied",
      details: "raw",
      metadata: { getMap: () => ({ reason: "policy" }) },
    });
    const res = await agent.post("/api/auth/register").send({ email: "meta@x.com", password: "pw" });
    expect(res.status).toBe(403);
  });

  it.each([
    ["ECONNRESET", "ECONNRESET"],
    ["ETIMEDOUT", "ETIMEDOUT"],
    ["EPIPE", "EPIPE"],
  ] as const)("proxy on.error with %s → 502 JSON", async (_label, code) => {
    const res = await agent
      .get("/api/listings/search?q=pe")
      .set("x-test-force-proxy-error", code);
    expect(res.status).toBe(502);
    expect(res.body?.error).toBe("upstream error");
  });

  it("proxy on.error with generic Error (no errno code) → 502", async () => {
    const res = await agent.get("/api/listings/search?q=gen").set("x-test-force-proxy-error", "GENERIC");
    expect(res.status).toBe(502);
  });

  it.each([
    ["NOT_FOUND", grpc.status.NOT_FOUND, 404],
    ["PERMISSION_DENIED", grpc.status.PERMISSION_DENIED, 403],
    ["UNAVAILABLE", grpc.status.UNAVAILABLE, 503],
    ["ALREADY_EXISTS", grpc.status.ALREADY_EXISTS, 409],
    ["RESOURCE_EXHAUSTED", grpc.status.RESOURCE_EXHAUSTED, 500],
    ["DEADLINE_EXCEEDED", grpc.status.DEADLINE_EXCEEDED, 500],
    ["ABORTED", grpc.status.ABORTED, 500],
    ["UNKNOWN", 999, 500],
  ] as const)("register maps gRPC %s → HTTP %s", async (_label, code, http) => {
    const err: Error & { code?: number; details?: string } = new Error("up");
    err.code = code;
    err.details = "raw";
    (promisifyGrpcCall as Mock).mockRejectedValueOnce(err);
    const res = await agent.post("/api/auth/register").send({ email: "g@grpc.map", password: "pw" });
    expect(res.status).toBe(http);
  });

  it("invalid JWT on protected route", async () => {
    verifyJwt.mockImplementationOnce(() => {
      throw new Error("jwt");
    });
    const res = await agent.get("/api/booking/x").set("Authorization", "Bearer x");
    expect(res.status).toBe(401);
  });

  it("terminal 404 handler after auth", async () => {
    const res = await agent.get("/no-such-top-level-route").set("Authorization", "Bearer good");
    expect(res.status).toBe(404);
  });
});
