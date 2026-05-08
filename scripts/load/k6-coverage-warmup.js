/**
 * Deterministic matrix endpoint warmup: one HTTP call per entry in gateway-route-manifest.json.
 * Ensures route-hit JSONL keys align with the static manifest (unlike randomized lab k6, which can
 * skip routes by chance). Does not replace OpenAPI or full E2E surface — only manifest coverage.
 *
 *   BASE_URL=https://off-campus-housing.test k6 run scripts/load/k6-coverage-warmup.js
 *
 * Env:
 *   K6_COVERAGE_MANIFEST — absolute or repo-relative path to gateway-route-manifest.json (Makefile sets absolute).
 */
import http from "k6/http";
import { check } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";
import { injectTraceparentIntoParams } from "./k6-w3c-traceparent.js";

const RAW_BASE = defaultRawBase();
const manifestRel = "scripts/coverage/gateway-route-manifest.json";
const manifestPath = __ENV.K6_COVERAGE_MANIFEST || manifestRel;
const manifest = JSON.parse(open(manifestPath));
const routes = manifest.routes || [];
const today = new Date().toISOString().slice(0, 10);

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: 1,
  iterations: 1,
  thresholds: {
    // Warmup records paths on non-2xx too; do not fail the run on expected 401/400 from unauthenticated POSTs.
    http_req_failed: ["rate<1"],
  },
});

function baseUrl() {
  return RAW_BASE.replace(/\/$/, "");
}

function timeoutForPath(path) {
  if (path.indexOf("/api/analytics/insights/listing-feel") !== -1) return "120s";
  if (path.indexOf("/api/debug/full-trace") !== -1) return "45s";
  if (path.indexOf("/api/analytics/daily-metrics") !== -1) return "30s";
  return "12s";
}

function params(name, path, extra) {
  const timeout = timeoutForPath(path);
  return injectTraceparentIntoParams(
    mergeEdgeTls(
      RAW_BASE,
      Object.assign({ tags: { name: name, coverage_warmup: "1" }, timeout: timeout }, extra || {}),
    ),
  );
}

function buildUrl(path) {
  const b = baseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  let url = `${b}${p}`;
  if (p.indexOf("/api/analytics/daily-metrics") !== -1 && url.indexOf("date=") === -1) {
    url += `${url.indexOf("?") === -1 ? "?" : "&"}date=${encodeURIComponent(today)}`;
  }
  return url;
}

function postBodyForPath(path) {
  if (path.indexOf("/api/analytics/insights/listing-feel") !== -1) {
    return JSON.stringify({
      title: "coverage-warmup",
      description: "matrix endpoint warmup",
      price_cents: 50000,
      audience: "renter",
    });
  }
  if (path.indexOf("/api/auth/register") !== -1) {
    return JSON.stringify({
      email: `warmup_${Date.now()}@loadtest.invalid`,
      password: "WarmupK6Pass!9z",
    });
  }
  if (path.indexOf("/api/auth/login") !== -1) {
    return JSON.stringify({ email: "warmup_nouser@loadtest.invalid", password: "x" });
  }
  if (path.indexOf("/api/auth/validate") !== -1 || path.indexOf("/api/auth/refresh") !== -1) {
    return JSON.stringify({ token: "invalid" });
  }
  return "{}";
}

export default function () {
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const method = String(r.method || "GET").toUpperCase();
    const path = r.path || "/";
    const url = buildUrl(path);
    const tag = `warmup_${i}_${method}`;
    let res;
    if (method === "GET") {
      res = http.get(url, params(tag, path));
    } else if (method === "POST") {
      const body = postBodyForPath(path);
      const hdr = { "Content-Type": "application/json" };
      res = http.post(url, body, params(tag, path, { headers: hdr }));
    } else {
      res = http.get(url, params(tag, path));
    }
    check(res, {
      [`${method} ${path} received response`]: (x) => x.status >= 100 && x.status < 600,
    });
  }
}
