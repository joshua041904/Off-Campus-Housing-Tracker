/**
 * Vertical capacity envelope: one service + one GET path per run.
 *
 * Env:
 *   SERVICE              — logical name (metadata)
 *   ENDPOINT_NAME        — slug for artifacts (e.g. healthz)
 *   ENDPOINT_PATH        — path + query (e.g. /api/listings/healthz)
 *   ENDPOINT_METHOD      — GET (default)
 *   ENVELOPE_MAX_RATE    — ramp ceiling (iterations/s), default 200
 *   ENVELOPE_STEP        — per-stage increase, default 25
 *   ENVELOPE_STAGE_DURATION — default 20s
 *   ENVELOPE_P95_MAX_MS  — threshold p95 ms, default 1200
 *   ENVELOPE_ERROR_RATE_MAX — threshold for checks + http_req_failed, default 0.05
 *   ENVELOPE_PRE_VUS / ENVELOPE_MAX_VUS — ramping-arrival-rate VU pool
 *   K6_ENVELOPE_SUMMARY_JSON — write handleSummary JSON here (required for report.py)
 *   Summary includes threshold_breached (true if final p95 ≥ ENVELOPE_P95_MAX_MS or error rates ≥ ENVELOPE_ERROR_RATE_MAX).
 *
 * TLS: SSL_CERT_FILE / BASE_URL — see k6-strict-edge-tls.js
 */
import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

export const envelope_errors = new Rate("envelope_errors");

const RAW_BASE = defaultRawBase();
const SERVICE = __ENV.SERVICE || "unknown";
const ENDPOINT_NAME = __ENV.ENDPOINT_NAME || "default";
const PATH = __ENV.ENDPOINT_PATH || "/api/listings/healthz";
const METHOD = (__ENV.ENDPOINT_METHOD || "GET").toUpperCase();
const MAX_RATE = Number(__ENV.ENVELOPE_MAX_RATE || __ENV.MAX_RATE || 200);
const STEP = Number(__ENV.ENVELOPE_STEP || __ENV.STEP || 25);
const STAGE_DUR = __ENV.ENVELOPE_STAGE_DURATION || "20s";
const P95_MAX = Number(__ENV.ENVELOPE_P95_MAX_MS || 1200);
const ERR_MAX = Number(__ENV.ENVELOPE_ERROR_RATE_MAX || 0.05);

const numStages = Math.max(1, Math.ceil(MAX_RATE / STEP));
const stages = [];
for (let i = 0; i < numStages; i++) {
  stages.push({ target: STEP * (i + 1), duration: STAGE_DUR });
}

const thr = {
  http_req_failed: ["rate<" + String(ERR_MAX)],
  http_req_duration: ["p(95)<" + String(P95_MAX)],
  envelope_errors: ["rate<" + String(ERR_MAX)],
};

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  scenarios: {
    envelope: {
      executor: "ramping-arrival-rate",
      startRate: Math.min(STEP, MAX_RATE),
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.ENVELOPE_PRE_VUS || 50),
      maxVUs: Number(__ENV.ENVELOPE_MAX_VUS || 200),
      stages: stages,
    },
  },
  thresholds: thr,
});

function fullUrl() {
  const p = PATH.indexOf("/") === 0 ? PATH : "/" + PATH;
  return RAW_BASE + p;
}

export default function () {
  const params = mergeEdgeTls(RAW_BASE, { timeout: "15s" });
  let res;
  if (METHOD === "GET") {
    res = http.get(fullUrl(), params);
  } else {
    res = http.request(METHOD, fullUrl(), null, params);
  }
  const ok = check(res, {
    "2xx": function (r) {
      return r.status >= 200 && r.status < 300;
    },
  });
  envelope_errors.add(!ok);
}

function metricVal(values, key) {
  if (!values) return null;
  const v = values[key];
  return v === undefined || v === null ? null : v;
}

export function handleSummary(data) {
  const m = data.metrics || {};
  const reqs = m.http_reqs && m.http_reqs.values ? m.http_reqs.values : {};
  const dur = m.http_req_duration && m.http_req_duration.values ? m.http_req_duration.values : {};
  const env = m.envelope_errors && m.envelope_errors.values ? m.envelope_errors.values : {};
  let p95 = metricVal(dur, "p(95)");
  if (p95 === null) p95 = metricVal(dur, "p95");

  const errRate = env.rate != null ? env.rate : 0;
  const failRate =
    m.http_req_failed && m.http_req_failed.values && m.http_req_failed.values.rate != null
      ? m.http_req_failed.values.rate
      : 0;
  const threshold_breached =
    (p95 != null && Number(p95) >= P95_MAX) ||
    errRate >= ERR_MAX ||
    failRate >= ERR_MAX;

  const summary = {
    service: SERVICE,
    endpoint: PATH,
    endpoint_name: ENDPOINT_NAME,
    rps: reqs.rate != null ? reqs.rate : 0,
    p95_ms: p95,
    error_rate: errRate,
    http_req_failed_rate:
      m.http_req_failed && m.http_req_failed.values && m.http_req_failed.values.rate != null
        ? m.http_req_failed.values.rate
        : null,
    iterations: reqs.count != null ? reqs.count : null,
    threshold_breached: threshold_breached,
    envelope_threshold_p95_ms: P95_MAX,
    envelope_threshold_error_rate: ERR_MAX,
  };

  const outPath = __ENV.K6_ENVELOPE_SUMMARY_JSON || "";
  const result = {};
  if (outPath) {
    result[outPath] = JSON.stringify(summary, null, 2);
  }
  return result;
}
