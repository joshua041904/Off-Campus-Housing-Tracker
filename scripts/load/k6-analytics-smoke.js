/**
 * Analytics edge smoke: gateway /api/analytics/* with latency + error thresholds.
 *
 *   BASE_URL=https://off-campus-housing.test k6 run scripts/load/k6-analytics-smoke.js
 *
 * Env: K6_ANALYTICS_SMOKE_MAX_FAIL_RATE — default 0.02; Makefile preflight uses 0.20 under lab load unless overridden.
 * Env: K6_ANALYTICS_SMOKE_P95_MAX_MS — default 2000 (was 500; gateway+Postgres often exceeds 500ms p95 under load).
 */
import http from "k6/http";
import { check } from "k6";

const base = (__ENV.BASE_URL || "https://off-campus-housing.test").replace(/\/$/, "");
/** YYYY-MM-DD — analytics-service returns 400 {"error":"date=YYYY-MM-DD required"} without this query param. */
const today = new Date().toISOString().slice(0, 10);

function numEnv(name, def) {
  const v = __ENV[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
/** Default 0.02; heavy lab: K6_ANALYTICS_SMOKE_MAX_FAIL_RATE=0.2 */
const smokeFailMax = numEnv("K6_ANALYTICS_SMOKE_MAX_FAIL_RATE", 0.02);
/** Edge + DB + proxy; default 2000ms p95 — 500ms was too tight under Colima load and fails the run even when all HTTP statuses are 2xx. */
const p95MaxMs = numEnv("K6_ANALYTICS_SMOKE_P95_MAX_MS", 2000);

const edgeHeaders = {
  "x-loadtest": "1",
  "x-suite": typeof __ENV.K6_X_SUITE === "string" && __ENV.K6_X_SUITE.trim() ? __ENV.K6_X_SUITE.trim() : "k6",
};

export const options = {
  insecureSkipTLSVerify: true,
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "25s",
  thresholds: {
    // http_req_failed = transport failure or HTTP status ≥400 (not the same as a failed `check()`).
    http_req_failed: [`rate<${smokeFailMax}`],
    http_req_duration: [`p(95)<${p95MaxMs}`],
  },
};

export default function () {
  const h = http.get(`${base}/api/analytics/healthz`, { tags: { name: "AnalyticsHealthz" }, headers: edgeHeaders });
  check(h, { "analytics healthz 2xx": (r) => r.status >= 200 && r.status < 300 });

  const d = http.get(`${base}/api/analytics/daily-metrics?date=${encodeURIComponent(today)}`, {
    tags: { name: "AnalyticsDailyMetrics" },
    headers: edgeHeaders,
  });
  check(d, { "analytics daily-metrics 2xx": (r) => r.status >= 200 && r.status < 300 });
}
