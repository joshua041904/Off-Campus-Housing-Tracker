/**
 * API Gateway — housing only. Uses proto: auth, listings, booking, messaging, notification, trust, analytics, media.
 * Ports per README: gateway 4020; auth 4011/50061, listings 4012/50062, booking 4013/50063, messaging 4014/50064,
 * notification 4015/50065, trust 4016/50066, analytics 4017/50067, media 4018/50068.
 *
 * Auth boundary: one global guard runs before service proxies (below). That does not mean every path under
 * /api needs JWT. Public routes are either mounted above the guard (explicit app.get or gRPC auth handlers),
 * listed in OPEN_ROUTES, or (for liveness) any GET whose path ends in /healthz (LB, smoke, k6). Everything
 * else needs Authorization: Bearer so the gateway can set x-user-id for upstreams.
 * Unknown /api/* paths (no mounted service prefix) return 404 before the guard so clients see not-found, not 401.
 */
import "./otel-bootstrap.js";
import { randomUUID } from "crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { ClientRequest } from "http";
import * as grpc from "@grpc/grpc-js";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { register, httpCounter, createHttpConcurrencyGuard } from "@common/utils";
import {
  inferNetProtoForSpan,
  injectTraceContextIntoClientRequest,
  mountDebugTraceHeaders,
  tracingMiddleware,
} from "@common/utils/otel";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import {
  createAuthClient,
  promisifyGrpcCall,
  verifyAuthGrpcUpstreamWithRetry,
} from "@common/utils/grpc-clients";
import { createGatewayRedis, shouldUseNoopGatewayRedis } from "./gateway-redis.js";
import type { ServerResponse as NodeServerResponse } from "http";
import { Agent as HttpAgent } from "http";
import type { Socket } from "net";
import { analyticsDailyMetricsCoalescedHandler, proxyInflightMiddleware } from "./proxy-limits.js";
import { createE2eTestModeInflightCapMiddleware } from "./e2e-test-mode-inflight-cap.js";
import { createE2eTrafficShaperMiddleware } from "./e2e-traffic-shaper.js";
import { createClusterWeightBudgetMiddleware } from "./cluster-weight-budget.js";
import { startWatchdogThrottlePoller } from "./watchdog-throttle-poll.js";
import { mountFullTraceDebug } from "./full-trace-debug-handler.js";
import { routeCoverageMiddleware } from "./route-coverage-middleware.js";

/** HTTP/1.1 keep-alive to housing upstreams: high concurrency from Caddy H2/H3 multiplexing + Playwright workers. */
const _gwMaxSockets = Number.parseInt(process.env.GATEWAY_HTTP_AGENT_MAX_SOCKETS ?? "1000", 10);
const gatewayMaxSockets = Number.isFinite(_gwMaxSockets) && _gwMaxSockets > 0 ? _gwMaxSockets : 1000;
const _gwFree = Number.parseInt(process.env.GATEWAY_HTTP_AGENT_MAX_FREE_SOCKETS ?? "256", 10);
const gatewayMaxFreeSockets = Number.isFinite(_gwFree) && _gwFree > 0 ? _gwFree : 256;

const keepAliveAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: gatewayMaxSockets,
  maxFreeSockets: gatewayMaxFreeSockets,
  keepAliveMsecs: 30_000,
});

// Housing gRPC targets (README ports)
const AUTH_GRPC_TARGET = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061";
const authGrpcClient = createAuthClient(AUTH_GRPC_TARGET);

/** K8s readiness: false until auth gRPC Health/Check succeeds (liveness uses /healthz only). */
let authUpstreamReady = false;

/** Vitest-only: flip readiness for `/readyz` branch coverage (never use outside tests). */
export function __testSetAuthUpstreamReady(value: boolean): void {
  if (process.env.VITEST !== "true") {
    throw new Error("__testSetAuthUpstreamReady is only available when VITEST=true");
  }
  authUpstreamReady = value;
}

// HTTP base URLs for housing services (README ports)
const AUTH_HTTP = process.env.AUTH_HTTP || "http://auth-service.off-campus-housing-tracker.svc.cluster.local:4011";
const LISTINGS_HTTP = process.env.LISTINGS_HTTP || "http://listings-service.off-campus-housing-tracker.svc.cluster.local:4012";
const BOOKING_HTTP = process.env.BOOKING_HTTP || "http://booking-service.off-campus-housing-tracker.svc.cluster.local:4013";
const MESSAGING_HTTP = process.env.MESSAGING_HTTP || "http://messaging-service.off-campus-housing-tracker.svc.cluster.local:4014";
const TRUST_HTTP = process.env.TRUST_HTTP || "http://trust-service.off-campus-housing-tracker.svc.cluster.local:4016";
const ANALYTICS_HTTP = process.env.ANALYTICS_HTTP || "http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";
const ANALYTICS_PROXY_TIMEOUT_MS = Number(process.env.ANALYTICS_PROXY_TIMEOUT_MS || "300000");
/** HTTP upstream for /media/* and /api/media/* (reverse proxy). Required: gateway does not map these paths to gRPC MediaService. See ENGINEERING.md § Service Communication Patterns → MEDIA_HTTP. */
const MEDIA_HTTP = process.env.MEDIA_HTTP || "http://media-service.off-campus-housing-tracker.svc.cluster.local:4018";
const NOTIFICATION_HTTP =
  process.env.NOTIFICATION_HTTP || "http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015";

type AuthedRequest = Request & { user?: { sub?: string; email?: string; jti?: string } };
type GatewayRequest = Request & { traceId?: string };

const TRACE_ID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function parseGrpcErrorPayload(err: any): { code: string; message: string } | null {
  const raw = err?.details || err?.message;
  if (typeof raw !== "string") return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.code === "string" &&
      typeof parsed.message === "string"
    ) {
      return { code: parsed.code, message: parsed.message };
    }
  } catch {
    // ignore parse failure
  }

  return null;
}

function handleGrpcError(res: Response, err: any, routeHint?: string) {
  const grpcCode = typeof err?.code === "number" ? err.code : -1;
  const status = grpcStatusToHttp[grpcCode] ?? 500;
  const hint = routeHint || "auth";

  const parsed = parseGrpcErrorPayload(err);
  const fallbackMessage =
    typeof err?.details === "string"
      ? err.details
      : typeof err?.message === "string"
        ? err.message
        : "grpc error";

  console.error(`[gateway → ${hint}] upstream gRPC error:`, {
    grpcCode,
    message: err?.message,
    details: err?.details,
    metadata: err?.metadata?.getMap?.() ?? undefined,
  });

  const body: Record<string, unknown> = parsed ?? {
    code: status === 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR",
    message: fallbackMessage,
  };

  if (verboseGrpcErrors) {
    body.detail = err?.message || String(err);
    if (grpcCode >= 0) body.grpcCode = grpcCode;
  }

  return res.status(status).json(body);
}

const jsonParser = express.json({ limit: "1mb" });

/** Strip query string for path matching; normalize duplicate slashes (some clients/proxies send `//api/...`). */
function gatewayPathOnly(req: Request): string {
  const raw = (req.originalUrl || req.url || "").split("?")[0];
  if (!raw.startsWith("/")) return raw;
  return raw.replace(/\/{2,}/g, "/");
}

/** GET liveness paths (gateway + upstream * /healthz) — never require JWT (avoids drift vs OPEN_ROUTES). */
function isGetHealthzBypass(req: Request): boolean {
  if (req.method !== "GET") return false;
  const p = gatewayPathOnly(req);
  if (p === "/health" || p === "/api/health") return true;
  return /\/healthz\/?$/.test(p);
}

/** Entire analytics HTTP surface is public at the gateway (no JWT). Quotas belong in rate limits / upstream, not here. */
function isPublicAnalyticsNamespaceBypass(req: Request): boolean {
  const p = gatewayPathOnly(req);
  return (
    p.startsWith("/api/analytics/") ||
    p === "/api/analytics" ||
    p.startsWith("/analytics/") ||
    p === "/analytics"
  );
}

const LISTING_INSIGHTS_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * Service-relative analytics paths (`/insights/...`) hit Caddy without `/api/analytics` prefix.
 * Only these POSTs are public at the gateway; other `/insights/*` (e.g. search-summary) still require JWT.
 */
function isPublicInsightsServicePost(req: Request): boolean {
  if (req.method !== "POST") return false;
  const p = gatewayPathOnly(req);
  if (!p.startsWith("/insights/")) return false;
  const feel = /^\/insights\/listing-feel\/?$/i;
  const feelMinimal = /^\/insights\/listing-feel-minimal\/?$/i;
  const hybrid = /^\/insights\/hybrid-search\/?$/i;
  const analyze = new RegExp(`^\\/insights\\/listing\\/${LISTING_INSIGHTS_UUID}\\/analyze\\/?$`, "i");
  return feel.test(p) || feelMinimal.test(p) || hybrid.test(p) || analyze.test(p);
}

const OPEN_ROUTES = [
  { method: "GET", pattern: /^\/healthz\/?$/ },
  { method: "GET", pattern: /^\/api\/healthz\/?$/ },
  { method: "GET", pattern: /^\/health\/?$/ },
  { method: "GET", pattern: /^\/api\/health\/?$/ },
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
  { method: "GET", pattern: /^\/(?:api\/)?listings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i },
  // Public reputation lookup (trust HTTP).
  { method: "GET", pattern: /^\/(?:api\/)?trust\/reputation\/[^/]+\/?$/ },
  // Step7 / trace-contract: multi-service fan-out under one trace id (no JWT).
  { method: "GET", pattern: /^\/(?:api\/)?debug\/full-trace\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?debug\/headers\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?booking\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?messaging\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?trust\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?media\/healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?notification\/healthz\/?$/ },
];

function isOpenRoute(req: Request): boolean {
  const method = req.method;
  const path = gatewayPathOnly(req);
  return OPEN_ROUTES.some((r) => r.method === method && r.pattern.test(path));
}

/**
 * POST-only analytics insight HTTP paths. GET must never reach the JWT guard (401).
 * Browser top-level navigation gets 303 → `/analytics`; API clients get 405 JSON + Allow: POST.
 */
const INSIGHTS_POST_ONLY_GET_PATHS = [
  "/insights/listing-feel",
  "/insights/listing-feel-minimal",
  "/insights/hybrid-search",
  "/api/analytics/insights/listing-feel",
  "/api/analytics/insights/listing-feel-minimal",
  "/api/analytics/insights/hybrid-search",
  "/analytics/insights/listing-feel",
  "/analytics/insights/listing-feel-minimal",
  "/analytics/insights/hybrid-search",
] as const;
const INSIGHTS_POST_ONLY_GET_PATH_SET = new Set<string>(INSIGHTS_POST_ONLY_GET_PATHS);

const INSIGHTS_ANALYZE_GET_405_REGEXES: ReadonlyArray<RegExp> = [
  new RegExp(`^\\/insights\\/listing\\/${LISTING_INSIGHTS_UUID}\\/analyze$`, "i"),
  new RegExp(`^\\/api\\/analytics\\/insights\\/listing\\/${LISTING_INSIGHTS_UUID}\\/analyze$`, "i"),
  new RegExp(`^\\/analytics\\/insights\\/listing\\/${LISTING_INSIGHTS_UUID}\\/analyze$`, "i"),
];

const INSIGHTS_POST_ONLY_GET_405_JSON = {
  error: "method_not_allowed",
  code: "POST_REQUIRED",
  message:
    "These endpoints accept POST with a JSON body only. Prefer POST /api/analytics/insights/listing-feel (or POST /insights/listing-feel through the gateway).",
  ui: "/analytics",
} as const;

function prefersHtmlDocumentNavigation(req: Request): boolean {
  const dest = (req.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "document") return true;
  const accept = (req.get("accept") || "").toLowerCase();
  if (!accept.includes("text/html")) return false;
  const trimmed = (req.get("accept") || "").trim();
  if (/^application\/json\b/i.test(trimmed)) return false;
  return true;
}

function isInsightsPostOnlyAnalyzeGetPath(normalizedPath: string): boolean {
  const p = normalizedPath.replace(/\/{2,}/g, "/");
  return INSIGHTS_ANALYZE_GET_405_REGEXES.some((rx) => rx.test(p));
}

function handleInsightsPostOnlyGet405(req: Request, res: Response): void {
  if (prefersHtmlDocumentNavigation(req)) {
    res
      .status(303)
      .set("Location", "/analytics")
      .set("Cache-Control", "no-store")
      .type("text/plain")
      .send(
        "Listing insights use POST with a JSON body. Redirecting to the analytics page.\n",
      );
    return;
  }
  res.status(405).set("Allow", "POST").json(INSIGHTS_POST_ONLY_GET_405_JSON);
}

function isInsightsPostOnlyGet405Path(req: Request): boolean {
  if (req.method !== "GET") return false;
  const p = gatewayPathOnly(req).replace(/\/{2,}/g, "/");
  const norm = p.replace(/\/+$/, "") || "/";
  return INSIGHTS_POST_ONLY_GET_PATH_SET.has(norm) || isInsightsPostOnlyAnalyzeGetPath(norm);
}

/** Vitest imports this module for HTTP assertions without binding a port. */
const skipGatewayHttpListen =
  process.env.VITEST === "true" || process.env.API_GATEWAY_TEST_IMPORT === "1";

const app: Express = express();
app.use(tracingMiddleware);
app.use(routeCoverageMiddleware());
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
const redis = createGatewayRedis(REDIS_URL);
if (!shouldUseNoopGatewayRedis()) {
  redis.on("error", (e: unknown) => console.error("gateway redis error:", e));
}

const e2eTestInflightCapOn =
  process.env.GATEWAY_E2E_TEST_INFLIGHT_CAP === "1" || process.env.GATEWAY_E2E_TEST_INFLIGHT_CAP === "true";
const e2eTrafficShaperOn =
  process.env.E2E_TRAFFIC_SHAPER === "1" || process.env.E2E_TRAFFIC_SHAPER === "true";
const clusterWeightBudgetOn =
  process.env.GATEWAY_CLUSTER_WEIGHT_ENABLED === "1" || process.env.GATEWAY_CLUSTER_WEIGHT_ENABLED === "true";
const WATCHDOG_THROTTLE_KEY = process.env.GATEWAY_WATCHDOG_THROTTLE_KEY || "och:gw:watchdog_throttle";

(async () => {
  try {
    await redis.connect();
    console.log("gateway redis connected");
    const pollWatchdogThrottle =
      e2eTrafficShaperOn ||
      clusterWeightBudgetOn ||
      process.env.GATEWAY_WATCHDOG_POLL === "1" ||
      process.env.GATEWAY_WATCHDOG_POLL === "true";
    if (pollWatchdogThrottle) {
      const pollMs = Math.max(2000, Number.parseInt(process.env.GATEWAY_WATCHDOG_POLL_MS ?? "5000", 10) || 5000);
      startWatchdogThrottlePoller(redis, WATCHDOG_THROTTLE_KEY, pollMs);
      console.log(`[gateway] watchdog throttle poll key=${WATCHDOG_THROTTLE_KEY} every ${pollMs}ms`);
    }
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
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-e2e-test",
      "x-test-mode",
      "X-Test-Mode",
      "X-Trace-Id",
      "traceparent",
      "tracestate",
      "x-suite",
    ],
    exposedHeaders: ["X-Trace-Id"],
  })
);
app.use(compression() as any);

app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = (req.get("x-trace-id") || "").trim();
  const traceId = TRACE_ID_RX.test(incoming) ? incoming : randomUUID();
  (req as GatewayRequest).traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);
  next();
});

app.get("/whoami", (_req, res) => res.json({ pod: process.env.HOSTNAME || require("os").hostname() }));
// Liveness: process is up and HTTP stack works (do not depend on auth).
app.get(["/healthz", "/api/healthz", "/health", "/api/health"], (_req, res) => res.json({ ok: true }));
// Readiness: auth gRPC+mTLS+Health verified (kube sends traffic only when this is 200).
app.get(["/readyz", "/api/readyz"], (_req, res) => {
  if (authUpstreamReady) return res.json({ ok: true, authUpstream: true });
  return res.status(503).json({ ok: false, authUpstream: false });
});
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Register before limiter/E2E middleware so GET never falls through to JWT guard.
const insightsPostOnlyGet405Handler = (req: Request, res: Response) => handleInsightsPostOnlyGet405(req, res);
for (const p of INSIGHTS_POST_ONLY_GET_PATHS) {
  app.get(p, insightsPostOnlyGet405Handler);
}
for (const rx of INSIGHTS_ANALYZE_GET_405_REGEXES) {
  app.get(rx, insightsPostOnlyGet405Handler);
}

if (e2eTestInflightCapOn) {
  const testInflightMax = Math.max(4, Number.parseInt(process.env.GATEWAY_E2E_TEST_INFLIGHT_MAX ?? "60", 10) || 60);
  app.use(createE2eTestModeInflightCapMiddleware({ maxConcurrent: testInflightMax }));
  console.log(`[gateway] GATEWAY_E2E_TEST_INFLIGHT_CAP on (labeled E2E maxConcurrent=${testInflightMax}, over cap → 429)`);
}

if (e2eTrafficShaperOn) {
  const maxC = Math.max(4, Number.parseInt(process.env.E2E_TRAFFIC_SHAPER_MAX ?? "50", 10) || 50);
  app.use(createE2eTrafficShaperMiddleware({ maxConcurrent: maxC }));
  console.log(`[gateway] E2E_TRAFFIC_SHAPER on (base maxConcurrent=${maxC})`);
}

if (clusterWeightBudgetOn) {
  const cap = Math.max(50, Number.parseInt(process.env.GATEWAY_CLUSTER_WEIGHT_CAP ?? "500", 10) || 500);
  const wkey = process.env.GATEWAY_CLUSTER_WEIGHT_KEY || "och:cluster:weight:sum";
  app.use(createClusterWeightBudgetMiddleware({ redis, key: wkey, cap }));
  console.log(`[gateway] GATEWAY_CLUSTER_WEIGHT_ENABLED key=${wkey} cap=${cap}`);
}

app.use(
  createHttpConcurrencyGuard({
    envVar: "GATEWAY_HTTP_MAX_CONCURRENT",
    defaultMax: 500,
    serviceLabel: "api-gateway",
  }),
);

app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") (req.query as any)[k] = v.replace(/[<>"'`;(){}]/g, "");
  }
  next();
});
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({
      service: "gateway",
      route: req.path,
      method: req.method,
      code: res.statusCode,
      proto: inferNetProtoForSpan(req),
    }),
  );
  next();
});

const limiter = rateLimit({
  windowMs: 60_000,
  max: process.env.DISABLE_RATE_LIMIT === "true" ? 999999 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // E2E only: header from Playwright — do not use NODE_ENV=test here (would disable limits for all traffic).
    const e2eBypass = req.get("x-e2e-test") === "1" || req.get("x-test-mode") === "1";
    const p = gatewayPathOnly(req);
    // Public auth must never be starved by the global limiter (register/login flakiness under parallel workers).
    if (
      req.method === "POST" &&
      (p === "/api/auth/register" ||
        p === "/auth/register" ||
        p === "/api/auth/login" ||
        p === "/auth/login")
    ) {
      return true;
    }
    // Analytics + bare /insights public POSTs: skip global limiter so k6/preflight does not 429 healthy upstreams.
    if (isPublicAnalyticsNamespaceBypass(req) || isPublicInsightsServicePost(req)) {
      return true;
    }
    return (
      e2eBypass ||
      req.path === "/healthz" ||
      req.path === "/api/healthz" ||
      req.path === "/health" ||
      req.path === "/api/health" ||
      req.path === "/readyz" ||
      req.path === "/api/readyz" ||
      req.path === "/metrics" ||
      req.path === "/api/debug/full-trace" ||
      req.path === "/debug/full-trace" ||
      req.path === "/api/debug/headers" ||
      req.path === "/debug/headers" ||
      req.get("x-loadtest") === "1"
    );
  },
});
app.use(limiter);

// ----- Health / metrics (no auth) -----
const tracedHealthProxyOn = {
  proxyReq(proxyReq: ClientRequest, req: Request) {
    injectTraceContextIntoClientRequest(proxyReq, req);
    const traceparent = req.get("traceparent");
    const tracestate = req.get("tracestate");
    if (traceparent) proxyReq.setHeader("traceparent", traceparent);
    if (tracestate) proxyReq.setHeader("tracestate", tracestate);
  },
};

app.use(
  "/auth/healthz",
  createProxyMiddleware({
    target: AUTH_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.use(
  "/auth/metrics",
  createProxyMiddleware({
    target: AUTH_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/metrics",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);

app.get(
  ["/listings/healthz", "/api/listings/healthz"],
  createProxyMiddleware({
    target: LISTINGS_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/booking/healthz", "/api/booking/healthz"],
  createProxyMiddleware({
    target: BOOKING_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/messaging/healthz", "/api/messaging/healthz"],
  createProxyMiddleware({
    target: MESSAGING_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/trust/healthz", "/api/trust/healthz"],
  createProxyMiddleware({
    target: TRUST_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/analytics/healthz", "/api/analytics/healthz"],
  createProxyMiddleware({
    target: ANALYTICS_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/media/healthz", "/api/media/healthz"],
  createProxyMiddleware({
    target: MEDIA_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);
app.get(
  ["/notification/healthz", "/api/notification/healthz"],
  createProxyMiddleware({
    target: NOTIFICATION_HTTP,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 5000,
    agent: keepAliveAgent,
    on: tracedHealthProxyOn,
  }),
);

mountFullTraceDebug(app, {
  authHttp: AUTH_HTTP,
  listingsHttp: LISTINGS_HTTP,
  trustHttp: TRUST_HTTP,
  bookingHttp: BOOKING_HTTP,
  messagingHttp: MESSAGING_HTTP,
  mediaHttp: MEDIA_HTTP,
  notificationHttp: NOTIFICATION_HTTP,
  analyticsHttp: ANALYTICS_HTTP,
});
mountDebugTraceHeaders(app);

// ----- gRPC auth (register, login, validate, refresh) -----
app.post("/auth/register", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Email and password are required",
    });
  }
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", { email, password }, 30000);
    res.status(201).json({ token: response?.token ?? "", user: response?.user ?? null });
  } catch (err: any) {
    handleGrpcError(res, err, "register");
  }
});
app.post("/api/auth/register", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Email and password are required",
    });
  }
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", { email, password }, 30000);
    res.status(201).json({ token: response?.token ?? "", user: response?.user ?? null });
  } catch (err: any) {
    handleGrpcError(res, err, "register");
  }
});

const loginHandler = async (req: Request, res: Response) => {
  const { email, password, mfaCode } = (req.body ?? {}) as { email?: string; password?: string; mfaCode?: string };
  if (!email || !password) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Email and password are required",
    });
  }
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
  if (!token) {
    return res.status(401).json({
      code: "MISSING_TOKEN",
      message: "Authorization token is required",
      valid: false,
    });
  }
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "ValidateToken", { token }, 30000);
    if (response?.valid) return res.status(200).json({ valid: true, user: response.user });
    return res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Token is invalid",
      valid: false,
    });
  } catch (err: any) {
    handleGrpcError(res, err, "validate");
  }
};
const refreshTokenHandler = async (req: Request, res: Response) => {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({
      code: "MISSING_TOKEN",
      message: "Authorization token is required",
    });
  }
  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "RefreshToken", { refresh_token: token }, 30000);
    if (response?.token) return res.status(200).json({ token: response.token });
    return res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Token is invalid",
    });
  } catch (err: any) {
    handleGrpcError(res, err, "refresh");
  }
};
app.post("/auth/validate", jsonParser, validateTokenHandler);
app.post("/api/auth/validate", jsonParser, validateTokenHandler);
app.post("/auth/refresh", jsonParser, refreshTokenHandler);
app.post("/api/auth/refresh", jsonParser, refreshTokenHandler);

// Unknown /api/* (no mounted service prefix) → 404 without JWT (avoids 401 on typos / missing routes).
const KNOWN_API_FIRST_SEGMENTS = new Set([
  "healthz",
  "readyz",
  "auth",
  "listings",
  "booking",
  "messaging",
  "forum",
  "messages",
  "trust",
  "analytics",
  "media",
  "notification",
  "debug",
]);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "OPTIONS") return next();
  const path = gatewayPathOnly(req);
  if (!path.startsWith("/api")) return next();
  if (path === "/api" || path === "/api/") {
    res.status(404).json({ error: "not found" });
    return;
  }
  const m = path.match(/^\/api\/([^/?]+)/);
  const seg = m ? m[1] : "";
  if (seg && KNOWN_API_FIRST_SEGMENTS.has(seg)) return next();
  res.status(404).json({ error: "not found" });
});

// ----- Auth guard (after public auth + health mounts; before service proxies). Register/login stay above this; the global limiter also skips those POST paths. -----
app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (isInsightsPostOnlyGet405Path(req)) {
    handleInsightsPostOnlyGet405(req, res);
    return;
  }
  if (isPublicAnalyticsNamespaceBypass(req) || isPublicInsightsServicePost(req)) return next();
  if (isGetHealthzBypass(req)) return next();
  if (isOpenRoute(req)) return next();
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({
      code: "MISSING_TOKEN",
      message: "Authorization token is required",
    });
  }
  try {
    const payload = verifyJwt(token) as TokenPayload & { jti?: string };
    if (payload?.jti) {
      try {
        const revoked = await Promise.race([redis.get(`revoked:${payload.jti}`), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 500))]) as string | null;
        if (revoked) return res.status(401).json({
          code: "TOKEN_REVOKED",
          message: "Token has been revoked",
        });
      } catch {
        // Redis down: proceed
      }
    }
    req.user = payload as any;
    next();
  } catch {
    return res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Token is invalid",
    });
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
    proxyReq(proxyReq: ClientRequest, req: Request) {
      injectTraceContextIntoClientRequest(proxyReq, req);
      const traceparent = req.get("traceparent");
      const tracestate = req.get("tracestate");
      if (traceparent) proxyReq.setHeader("traceparent", traceparent);
      if (tracestate) proxyReq.setHeader("tracestate", tracestate);
      const tid = (req as GatewayRequest).traceId;
      if (tid) proxyReq.setHeader("X-Trace-Id", tid);
    },
  },
});

const GATEWAY_PROXY_MAX_INFLIGHT = Math.max(0, parseInt(process.env.GATEWAY_PROXY_MAX_INFLIGHT || "0", 10) || 0);
const proxyLoad = proxyInflightMiddleware(GATEWAY_PROXY_MAX_INFLIGHT);
const coalesceAnalyticsDaily =
  process.env.GATEWAY_COALESCE_ANALYTICS_DAILY === "1" || process.env.GATEWAY_COALESCE_ANALYTICS_DAILY === "true";

app.use("/auth", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(AUTH_HTTP, { "^/auth": "" }) as any));
app.use("/api/auth", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(AUTH_HTTP, { "^/api/auth": "" }) as any));

app.use("/listings", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(LISTINGS_HTTP, { "^/listings": "" }) as any));
app.use("/api/listings", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(LISTINGS_HTTP, { "^/api/listings": "" }) as any));

app.use("/booking", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/booking": "" }) as any));
app.use("/api/booking", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/api/booking": "" }) as any));
app.use("/bookings", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/bookings": "" }) as any));
app.use("/api/bookings", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(BOOKING_HTTP, { "^/api/bookings": "" }) as any));

app.use("/messaging", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(MESSAGING_HTTP, { "^/messaging": "" }) as any));
app.use("/api/messaging", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(MESSAGING_HTTP, { "^/api/messaging": "" }) as any));

// Backward compatible: forum + messages are served by messaging-service,
// historically accessed under /api/forum and /api/messages.
app.use(
  "/api/forum",
  injectIdentityHeadersIfAny,
  proxyLoad,
  createProxyMiddleware(proxyOpts(`${MESSAGING_HTTP}/forum`, { "^/": "/" }) as any)
);
app.use(
  "/api/messages",
  injectIdentityHeadersIfAny,
  proxyLoad,
  createProxyMiddleware(proxyOpts(`${MESSAGING_HTTP}/messages`, { "^/": "/" }) as any)
);

app.use("/trust", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(TRUST_HTTP, { "^/trust": "" }) as any));
app.use("/api/trust", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(TRUST_HTTP, { "^/api/trust": "" }) as any));

if (coalesceAnalyticsDaily) {
  const dailyHandler = analyticsDailyMetricsCoalescedHandler({
    analyticsHttpBase: ANALYTICS_HTTP,
    agent: keepAliveAgent,
  });
  app.get(["/analytics/daily-metrics", "/api/analytics/daily-metrics"], proxyLoad, dailyHandler);
}

app.use(
  "/analytics",
  injectIdentityHeadersIfAny,
  proxyLoad,
  createProxyMiddleware(proxyOpts(ANALYTICS_HTTP, { "^/analytics": "" }, ANALYTICS_PROXY_TIMEOUT_MS) as any)
);
// Strip `/api/analytics` so upstream sees analytics-service paths (e.g. `/insights/listing-feel`).
app.use(
  "/api/analytics",
  injectIdentityHeadersIfAny,
  proxyLoad,
  createProxyMiddleware(proxyOpts(ANALYTICS_HTTP, { "^/api/analytics": "" }, ANALYTICS_PROXY_TIMEOUT_MS) as any)
);
// Same analytics HTTP app as /api/analytics/*, for edges that forward service-relative paths (must match Caddy @api /insights/*).
app.use(
  "/insights",
  injectIdentityHeadersIfAny,
  proxyLoad,
  createProxyMiddleware(proxyOpts(ANALYTICS_HTTP, { "^/insights": "/insights" }, ANALYTICS_PROXY_TIMEOUT_MS) as any)
);

// Media can be slow (S3/DB); avoid 504 on healthz through edge
app.use("/media", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(MEDIA_HTTP, { "^/media": "" }, 45000) as any));
app.use("/api/media", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(MEDIA_HTTP, { "^/api/media": "" }, 45000) as any));

app.use("/notification", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(NOTIFICATION_HTTP, { "^/notification": "" }) as any));
app.use("/api/notification", injectIdentityHeadersIfAny, proxyLoad, createProxyMiddleware(proxyOpts(NOTIFICATION_HTTP, { "^/api/notification": "" }) as any));

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
  if (skipGatewayHttpListen) {
    if (process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY === "1" || process.env.GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY === "true") {
      authUpstreamReady = true;
    } else {
      await ensureAuthUpstreamBackground();
    }
    return;
  }
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

export { app, statusFromGatewayError, sendJson502 };

void startGateway().catch((e) => {
  console.error("[gateway] bootstrap failed:", e);
  process.exit(1);
});
