/**
 * API Gateway — housing only. Uses proto: auth, listings, booking, messaging, notification, trust, analytics, media.
 * Ports per README: gateway 4020; auth 4011/50061, listings 4012/50062, booking 4013/50063, messaging 4014/50064,
 * notification 4015/50065, trust 4016/50066, analytics 4017/50067, media 4018/50068.
 *
 * Auth boundary: one global guard runs before service proxies (below). That does not mean every path under
 * /api needs JWT. Public routes are either mounted above the guard (explicit app.get or gRPC auth handlers),
 * listed in OPEN_ROUTES, or (for liveness) any GET whose path ends in /healthz (LB, smoke, k6). Everything
 * else needs Authorization: Bearer so the gateway can set x-user-id for upstreams.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import * as grpc from "@grpc/grpc-js";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { register, httpCounter } from "@common/utils";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import {
  createAuthClient,
  promisifyGrpcCall,
  verifyAuthGrpcUpstreamWithRetry,
} from "@common/utils/grpc-clients";
import { createClient } from "redis";
import type { ServerResponse as NodeServerResponse } from "http";
import { Agent as HttpAgent } from "http";
import type { Socket } from "net";

const keepAliveAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: 200,
  maxFreeSockets: 50,
  keepAliveMsecs: 30_000,
});

// Housing gRPC targets (README ports)
const AUTH_GRPC_TARGET = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061";
const authGrpcClient = createAuthClient(AUTH_GRPC_TARGET);

/** K8s readiness: false until auth gRPC Health/Check succeeds (liveness uses /healthz only). */
let authUpstreamReady = false;

// HTTP base URLs for housing services (README ports)
const AUTH_HTTP = process.env.AUTH_HTTP || "http://auth-service.off-campus-housing-tracker.svc.cluster.local:4011";
const LISTINGS_HTTP = process.env.LISTINGS_HTTP || "http://listings-service.off-campus-housing-tracker.svc.cluster.local:4012";
const BOOKING_HTTP = process.env.BOOKING_HTTP || "http://booking-service.off-campus-housing-tracker.svc.cluster.local:4013";
const MESSAGING_HTTP = process.env.MESSAGING_HTTP || "http://messaging-service.off-campus-housing-tracker.svc.cluster.local:4014";
const TRUST_HTTP = process.env.TRUST_HTTP || "http://trust-service.off-campus-housing-tracker.svc.cluster.local:4016";
const ANALYTICS_HTTP = process.env.ANALYTICS_HTTP || "http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";
/** HTTP upstream for /media/* and /api/media/* (reverse proxy). Required: gateway does not map these paths to gRPC MediaService. See ENGINEERING.md § Service Communication Patterns → MEDIA_HTTP. */
const MEDIA_HTTP = process.env.MEDIA_HTTP || "http://media-service.off-campus-housing-tracker.svc.cluster.local:4018";
const NOTIFICATION_HTTP =
  process.env.NOTIFICATION_HTTP || "http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015";

type AuthedRequest = Request & { user?: { sub?: string; email?: string; jti?: string } };

function sendJson502(res: NodeServerResponse | Socket, msg: string) {
  if ("setHeader" in res) {
    const sr = res as NodeServerResponse;
    if (!sr.headersSent) {
      sr.statusCode = 502;
      sr.setHeader("Content-Type", "application/json");
      sr.end(JSON.stringify({ error: msg }));
    }
  } else {
    try {
      (res as Socket).destroy();
    } catch {}
  }
}

function extractBearer(req: Request): string | undefined {
  const raw = req.get("authorization") ?? (req.headers.authorization as string) ?? "";
  const s = String(raw).trim();
  const i = s.toLowerCase().indexOf("bearer ");
  if (i === -1) return undefined;
  return s.slice(i + "bearer ".length).trim() || undefined;
}

function injectIdentityHeadersIfAny(req: AuthedRequest, _res: Response, next: NextFunction) {
  delete (req.headers as any)["x-user-id"];
  delete (req.headers as any)["x-user-email"];
  delete (req.headers as any)["x-user-jti"];
  if (req.user?.sub) (req.headers as any)["x-user-id"] = req.user.sub;
  if ((req.user as any)?.email) (req.headers as any)["x-user-email"] = (req.user as any).email;
  if ((req.user as any)?.jti) (req.headers as any)["x-user-jti"] = (req.user as any).jti;
  next();
}

const grpcStatusToHttp: Record<number, number> = {
  [grpc.status.INVALID_ARGUMENT ?? 3]: 400,
  [grpc.status.UNAUTHENTICATED ?? 16]: 401,
  [grpc.status.PERMISSION_DENIED ?? 7]: 403,
  [grpc.status.NOT_FOUND ?? 5]: 404,
  [grpc.status.ALREADY_EXISTS ?? 6]: 409,
  [grpc.status.UNAVAILABLE ?? 14]: 503,
};

const verboseGrpcErrors =
  process.env.NODE_ENV !== "production" || process.env.GATEWAY_VERBOSE_GRPC_ERRORS === "1";

function handleGrpcError(res: Response, err: any, routeHint?: string) {
  const code = typeof err?.code === "number" ? err.code : -1;
  const status = grpcStatusToHttp[code] ?? 500;
  const message = err?.details || err?.message || "grpc error";
  const hint = routeHint || "auth";
  console.error(`[gateway → ${hint}] upstream gRPC error:`, {
    grpcCode: code,
    message: err?.message,
    details: err?.details,
    metadata: err?.metadata?.getMap?.() ?? undefined,
  });
  const body: Record<string, unknown> = { error: message };
  if (verboseGrpcErrors) {
    body.detail = err?.message || String(err);
    if (code >= 0) body.grpcCode = code;
  }
  res.status(status).json(body);
}

const jsonParser = express.json({ limit: "1mb" });

/** Strip query string for path matching. */
function gatewayPathOnly(req: Request): string {
  return (req.originalUrl || req.url || "").split("?")[0];
}

/** Any GET path ending in /healthz is upstream liveness — never require JWT (avoids drift vs OPEN_ROUTES). */
function isGetHealthzBypass(req: Request): boolean {
  if (req.method !== "GET") return false;
  return /\/healthz\/?$/.test(gatewayPathOnly(req));
}

const OPEN_ROUTES = [
  { method: "GET", pattern: /^\/healthz\/?$/ },
  { method: "GET", pattern: /^\/api\/healthz\/?$/ },
  { method: "GET", pattern: /^\/readyz\/?$/ },
  { method: "GET", pattern: /^\/api\/readyz\/?$/ },
  { method: "GET", pattern: /^\/metrics\/?$/ },
  { method: "GET", pattern: /^\/whoami\/?$/ },
  { method: "POST", pattern: /^\/auth\/register\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/register\/?$/ },
  { method: "POST", pattern: /^\/auth\/login\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/login\/?$/ },
  { method: "POST", pattern: /^\/auth\/validate\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/validate\/?$/ },
  { method: "POST", pattern: /^\/auth\/refresh\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/refresh\/?$/ },
  { method: "GET", pattern: /^\/auth\/healthz\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/healthz\/?$/ },
  { method: "GET", pattern: /^\/auth\/metrics\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/metrics\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?listings\/healthz\/?$/ },
  // Public browse: index + search + single listing (no JWT). POST /create stays protected via proxy + x-user-id.
  { method: "GET", pattern: /^\/(?:api\/)?listings\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?listings\/search\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?listings\/listings\/[^/]+\/?$/ },
  // Public reputation lookup (trust HTTP).
  { method: "GET", pattern: /^\/(?:api\/)?trust\/reputation\/[^/]+\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?booking\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?messaging\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?trust\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?analytics\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?analytics\/daily-metrics\/?$/ },
  // Listing "feel" uses optional JWT upstream; allow unauthenticated for smoke/k6 when Ollama is enabled.
  { method: "POST", pattern: /^\/(?:api\/)?analytics\/insights\/listing-feel\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?media\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?notification\/healthz\/?$/ },
];

function isOpenRoute(req: Request): boolean {
  const method = req.method;
  const path = gatewayPathOnly(req);
  return OPEN_ROUTES.some((r) => r.method === method && r.pattern.test(path));
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAKE_AUTH = process.env.DEBUG_FAKE_AUTH === "1" || process.env.DEBUG_FAKE_AUTH === "true";
if (FAKE_AUTH) {
  app.use((req, _res, next) => {
    const hdr = req.get("x-user-id") || "";
    if (UUID_RX.test(hdr)) {
      (req as any).user = { sub: hdr };
    }
    next();
  });
}

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const redis = createClient({ url: REDIS_URL, socket: { connectTimeout: 10_000 } });
redis.on("error", (e: unknown) => console.error("gateway redis error:", e));
(async () => {
  try {
    await redis.connect();
    console.log("gateway redis connected");
  } catch (e) {
    console.error("gateway redis connect failed:", e);
  }
})();

app.use(
  helmet({
    contentSecurityPolicy: { useDefaults: true, directives: { "default-src": ["'self'"] } },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: [
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https:\/\/off-campus-housing\.local(:\d+)?$/,
      /^https:\/\/off-campus-housing\.test(:\d+)?$/,
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-e2e-test"],
  })
);
app.use(compression() as any);

app.get("/whoami", (_req, res) => res.json({ pod: process.env.HOSTNAME || require("os").hostname() }));
// Liveness: process is up and HTTP stack works (do not depend on auth).
app.get(["/healthz", "/api/healthz"], (_req, res) => res.json({ ok: true }));
// Readiness: auth gRPC+mTLS+Health verified (kube sends traffic only when this is 200).
app.get(["/readyz", "/api/readyz"], (_req, res) => {
  if (authUpstreamReady) return res.json({ ok: true, authUpstream: true });
  return res.status(503).json({ ok: false, authUpstream: false });
});
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") (req.query as any)[k] = v.replace(/[<>"'`;(){}]/g, "");
  }
  next();
});
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => httpCounter.inc({ service: "gateway", route: req.path, method: req.method, code: res.statusCode }));
  next();
});

const limiter = rateLimit({
  windowMs: 60_000,
  max: process.env.DISABLE_RATE_LIMIT === "true" ? 999999 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // E2E only: header from Playwright — do not use NODE_ENV=test here (would disable limits for all traffic).
    const e2eBypass = req.get("x-e2e-test") === "1";
    return (
      e2eBypass ||
      req.path === "/healthz" ||
      req.path === "/api/healthz" ||
      req.path === "/readyz" ||
      req.path === "/api/readyz" ||
      req.path === "/metrics" ||
      req.get("x-loadtest") === "1"
    );
  },
});
app.use(limiter);

// ----- Health / metrics (no auth) -----
app.use("/auth/healthz", createProxyMiddleware({ target: AUTH_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 10000, agent: keepAliveAgent }));
app.use("/auth/metrics", createProxyMiddleware({ target: AUTH_HTTP, changeOrigin: true, pathRewrite: () => "/metrics", proxyTimeout: 10000, agent: keepAliveAgent }));

app.get(["/listings/healthz", "/api/listings/healthz"], createProxyMiddleware({ target: LISTINGS_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/booking/healthz", "/api/booking/healthz"], createProxyMiddleware({ target: BOOKING_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/messaging/healthz", "/api/messaging/healthz"], createProxyMiddleware({ target: MESSAGING_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/trust/healthz", "/api/trust/healthz"], createProxyMiddleware({ target: TRUST_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/analytics/healthz", "/api/analytics/healthz"], createProxyMiddleware({ target: ANALYTICS_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/media/healthz", "/api/media/healthz"], createProxyMiddleware({ target: MEDIA_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));
app.get(["/notification/healthz", "/api/notification/healthz"], createProxyMiddleware({ target: NOTIFICATION_HTTP, changeOrigin: true, pathRewrite: () => "/healthz", proxyTimeout: 5000, agent: keepAliveAgent }));

// ----- gRPC auth (register, login, validate, refresh) -----
app.post("/auth/register", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "email/password required" });
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", { email, password }, 30000);
    res.status(201).json({ token: response?.token ?? "", user: response?.user ?? null });
  } catch (err: any) {
    handleGrpcError(res, err, "register");
  }
});
app.post("/api/auth/register", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "email/password required" });
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", { email, password }, 30000);
    res.status(201).json({ token: response?.token ?? "", user: response?.user ?? null });
  } catch (err: any) {
    handleGrpcError(res, err, "register");
  }
});

const loginHandler = async (req: Request, res: Response) => {
  const { email, password, mfaCode } = (req.body ?? {}) as { email?: string; password?: string; mfaCode?: string };
  if (!email || !password) return res.status(400).json({ error: "email/password required" });
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Authenticate", { email, password, mfa_code: mfaCode }, 30000);
    const requiresMFA = response?.requires_mfa === true || (!response?.token && (response?.user_id || response?.user?.id));
    if (requiresMFA) return res.status(200).json({ requiresMFA: true, userId: response?.user_id ?? response?.user?.id ?? null, message: response?.message ?? "MFA code required" });
    res.json({ token: response?.token ?? "", refreshToken: response?.refresh_token ?? "", user: response?.user ?? null });
  } catch (err: any) {
    handleGrpcError(res, err, "login");
  }
};
app.post("/auth/login", jsonParser, loginHandler);
app.post("/api/auth/login", jsonParser, loginHandler);

const validateTokenHandler = async (req: Request, res: Response) => {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "missing token", valid: false });
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "ValidateToken", { token }, 30000);
    if (response?.valid) return res.status(200).json({ valid: true, user: response.user });
    return res.status(401).json({ error: "invalid token", valid: false });
  } catch (err: any) {
    handleGrpcError(res, err, "validate");
  }
};
const refreshTokenHandler = async (req: Request, res: Response) => {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "RefreshToken", { refresh_token: token }, 30000);
    if (response?.token) return res.status(200).json({ token: response.token });
    return res.status(401).json({ error: "invalid token" });
  } catch (err: any) {
    handleGrpcError(res, err, "refresh");
  }
};
app.post("/auth/validate", jsonParser, validateTokenHandler);
app.post("/api/auth/validate", jsonParser, validateTokenHandler);
app.post("/auth/refresh", jsonParser, refreshTokenHandler);
app.post("/api/auth/refresh", jsonParser, refreshTokenHandler);

// ----- Auth guard (after public auth + health mounts; before service proxies) -----
app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (isGetHealthzBypass(req)) return next();
  if (isOpenRoute(req)) return next();
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "auth required" });
  try {
    const payload = verifyJwt(token) as TokenPayload & { jti?: string };
    if (payload?.jti) {
      try {
        const revoked = await Promise.race([redis.get(`revoked:${payload.jti}`), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 500))]) as string | null;
        if (revoked) return res.status(401).json({ error: "token revoked" });
      } catch {
        // Redis down: proceed
      }
    }
    req.user = payload as any;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
});

// ----- Protected HTTP proxies (housing services) -----
const proxyOpts = (target: string, pathRewrite: Record<string, string>, proxyTimeoutMs = 15000) => ({
  target,
  changeOrigin: true,
  pathRewrite,
  proxyTimeout: proxyTimeoutMs,
  agent: keepAliveAgent,
  on: {
    error(err: any, _req: Request, res: Response) {
      console.error("[gw] proxy error:", err?.message);
      sendJson502(res as NodeServerResponse, "upstream error");
    },
  },
});

app.use("/auth", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(AUTH_HTTP, { "^/auth": "" }) as any));
app.use("/api/auth", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(AUTH_HTTP, { "^/api/auth": "" }) as any));

app.use("/listings", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(LISTINGS_HTTP, { "^/listings": "" }) as any));
app.use("/api/listings", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(LISTINGS_HTTP, { "^/api/listings": "" }) as any));

app.use("/booking", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/booking": "" }) as any));
app.use("/api/booking", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/api/booking": "" }) as any));

app.use("/messaging", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(MESSAGING_HTTP, { "^/messaging": "" }) as any));
app.use("/api/messaging", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(MESSAGING_HTTP, { "^/api/messaging": "" }) as any));

// Backward compatible: forum + messages are served by messaging-service,
// historically accessed under /api/forum and /api/messages.
app.use(
  "/api/forum",
  injectIdentityHeadersIfAny,
  createProxyMiddleware(proxyOpts(`${MESSAGING_HTTP}/forum`, { "^/": "/" }) as any)
);
app.use(
  "/api/messages",
  injectIdentityHeadersIfAny,
  createProxyMiddleware(proxyOpts(`${MESSAGING_HTTP}/messages`, { "^/": "/" }) as any)
);

app.use("/trust", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(TRUST_HTTP, { "^/trust": "" }) as any));
app.use("/api/trust", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(TRUST_HTTP, { "^/api/trust": "" }) as any));

app.use("/analytics", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(ANALYTICS_HTTP, { "^/analytics": "" }) as any));
app.use("/api/analytics", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(ANALYTICS_HTTP, { "^/api/analytics": "" }) as any));

// Media can be slow (S3/DB); avoid 504 on healthz through edge
app.use("/media", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(MEDIA_HTTP, { "^/media": "" }, 45000) as any));
app.use("/api/media", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(MEDIA_HTTP, { "^/api/media": "" }, 45000) as any));

app.use("/notification", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(NOTIFICATION_HTTP, { "^/notification": "" }) as any));
app.use("/api/notification", injectIdentityHeadersIfAny, createProxyMiddleware(proxyOpts(NOTIFICATION_HTTP, { "^/api/notification": "" }) as any));

app.use((_req, res) => res.status(404).json({ error: "not found" }));

/** Preserve 4xx from body-parser / express.json (invalid JSON) instead of collapsing to 500. */
function statusFromGatewayError(err: unknown): number {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown };
    const s = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : NaN;
    if (s >= 400 && s < 600) return s;
  }
  if (err instanceof SyntaxError) return 400;
  const name = err instanceof Error ? err.name : "";
  if (name === "PayloadTooLargeError" || name === "URIError") return 400;
  return 500;
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  const status = statusFromGatewayError(err);
  console.error("[gw] Unhandled error:", msg, `(→ HTTP ${status})`);
  if (!res.headersSent) {
    res.status(status).json({
      error: status >= 500 ? "internal" : "bad request",
      ...(status < 500 && msg ? { detail: msg } : {}),
    });
  }
});

// Housing port 4020 per README — listen immediately; verify auth in background and gate readiness on /readyz (K8s-native).
const gatewayPort = Number(process.env.GATEWAY_PORT || "4020");

async function ensureAuthUpstreamBackground(): Promise<void> {
  if (
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY === "1" ||
    process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY === "true"
  ) {
    console.warn("[gateway] GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY=1 — /readyz true without auth verify (not recommended)");
    authUpstreamReady = true;
    return;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let pauseMs = Number(process.env.GATEWAY_AUTH_VERIFY_RETRY_INITIAL_MS || "2000");
  const pauseMax = Number(process.env.GATEWAY_AUTH_VERIFY_RETRY_MAX_MS || "30000");

  for (;;) {
    try {
      await verifyAuthGrpcUpstreamWithRetry(AUTH_GRPC_TARGET);
      authUpstreamReady = true;
      console.log("[gateway] auth-service gRPC upstream verified — /readyz OK");
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[gateway] auth upstream not ready yet (retrying):", msg);
      await sleep(pauseMs);
      pauseMs = Math.min(Math.floor(pauseMs * 1.5), pauseMax);
    }
  }
}

async function startGateway() {
  console.log(`[gateway] AUTH_GRPC_TARGET=${AUTH_GRPC_TARGET}`);
  await new Promise<void>((resolve, reject) => {
    const srv = app.listen(gatewayPort, () => {
      console.log(
        `[gateway] listening on :${gatewayPort} (liveness /healthz; readiness /readyz until auth upstream OK)`
      );
      resolve();
    });
    srv.on("error", reject);
  });
  void ensureAuthUpstreamBackground().catch((e) => {
    console.error("[gateway] auth upstream verifier crashed:", e);
  });
}

void startGateway().catch((e) => {
  console.error("[gateway] bootstrap failed:", e);
  process.exit(1);
});
