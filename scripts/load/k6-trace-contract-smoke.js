/**
 * k6: one W3C trace id per iteration; parallel GET fan-out across public gateway routes (race-style load on edge + upstreams).
 * Post-run: scripts/validate-k6-traces.sh parses K6_TRACE_ID + 32-hex trace id from this log (structured k6 lines OK).
 *
 * Env:
 *   BASE_URL — default https://off-campus-housing.test
 *   K6_TRACE_VUS — default 4 (concurrent VUs hammering the same route set)
 *   K6_TRACE_ITERATIONS — default 12 (total iterations across all VUs)
 *
 * Run:
 *   BASE_URL=https://off-campus-housing.test k6 run scripts/load/k6-trace-contract-smoke.js 2>&1 | tee bench_logs/k6-trace-contract.log
 */
import http from "k6/http";
import { check } from "k6";

const BASE = (__ENV.BASE_URL || "https://off-campus-housing.test").replace(/\/$/, "");

function traceparent() {
  const hex = () => Math.floor(Math.random() * 16 ** 8).toString(16).padStart(8, "0");
  const traceId = (hex() + hex() + hex() + hex()).slice(0, 32);
  const parentId = "0123456789abcdef";
  return { traceparent: `00-${traceId}-${parentId}-01`, traceId };
}

/** Public GET paths via api-gateway (OPEN_ROUTES class — no JWT). Order: light probes → full-trace (heaviest). */
function publicTraceBatchUrls() {
  // Public GETs via api-gateway (no JWT). Omit /api/analytics/daily-metrics (needs query / upstream data; flaky 4xx).
  return [
    "/api/healthz",
    "/api/readyz",
    "/api/debug/headers",
    "/api/auth/healthz",
    "/api/booking/healthz",
    "/api/messaging/healthz",
    "/api/trust/healthz",
    "/api/analytics/healthz",
    "/api/media/healthz",
    "/api/notification/healthz",
    "/api/listings/healthz",
    "/api/listings?limit=3",
    "/api/listings/search?limit=1",
    "/api/debug/full-trace",
  ];
}

const vus = Number(__ENV.K6_TRACE_VUS || 4);
const iterations = Number(__ENV.K6_TRACE_ITERATIONS || 12);

export const options = {
  vus,
  iterations,
  // Dev edge uses repo CA; k6 must skip verify (same class as curl -k in trace-contract-test.sh).
  insecureSkipTLSVerify: true,
  thresholds: {
    checks: ["rate>0.95"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const { traceparent: tp, traceId } = traceparent();
  const k6Suite = typeof __ENV.K6_X_SUITE === "string" && __ENV.K6_X_SUITE.trim() ? __ENV.K6_X_SUITE.trim() : "k6";
  const params = {
    headers: {
      traceparent: tp,
      "x-debug-replay": "k6-trace-contract",
      "x-och-edge-proto": "h3",
      "x-loadtest": "1",
      "x-suite": k6Suite,
    },
  };

  const paths = publicTraceBatchUrls();
  /** @type {import("k6/http").BatchRequest[]} */
  const batch = paths.map((path) => ["GET", `${BASE}${path}`, null, params]);

  const responses = http.batch(batch);

  let allOk = true;
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    const path = paths[i];
    const ok = check(r, {
      [`${path} 2xx`]: (res) => res.status >= 200 && res.status < 300,
    });
    if (!ok) allOk = false;
  }

  check(null, { "batch all 2xx": () => allOk });
  console.log(`K6_TRACE_ID ${traceId}`);
}
