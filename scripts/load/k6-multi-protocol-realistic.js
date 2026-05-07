/**
 * Multi-protocol realistic edge load: H1 / H2 / H3 scenarios with unique URLs + auth/register traffic.
 *
 * Goals:
 *   - Tag every request with proto=h1|h2|h3 for k6 → Prometheus / dashboards (subset of metrics honor tags).
 *   - Avoid cache-only health noise: mix health, public search, trust lookup, register+login with unique emails.
 *
 * Env:
 *   BASE_URL — https://off-campus-housing.test (default)
 *   DURATION — per-scenario duration (default 2m)
 *   K6_H1_RATE / K6_H2_RATE / K6_H3_RATE — iterations/s per scenario (defaults 8,8,5)
 *   K6_HTTP3_REQUIRE_MODULE — set 1 when using h3 scenario with stock k6 to fail fast (see k6-gateway-health-http3.js)
 *   K6_REALISTIC_SLEEP_MS — sleep between actions inside one iteration (default 0)
 *   K6_PREALLOCATED_VUS / K6_MAX_VUS — h1+h2 pool (defaults 40 / 200)
 *   K6_REALISTIC_H3_PRE_VUS / K6_REALISTIC_H3_MAX_VUS — h3 only (defaults 10 / 80; Colima QUIC/UDP budget)
 *   K6_REALISTIC_H3_ONLY=1 — h3 scenario only (isolate QUIC vs mixed H1/H2/H3)
 *
 * HTTP/3: build k6-http3 (.k6-build/bin/k6-http3) and run that binary; otherwise h3 scenario uses HTTP/2 fallback
 * with tag proto=h3 (label = intended protocol).
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import {
  defaultRawBase,
  mergeEdgeTlsWithProtocol,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";
import { injectTraceparentIntoParams } from "./k6-w3c-traceparent.js";

let http3 = null;
try {
  http3 = require("k6/x/http3");
} catch (_e) {
  http3 = null;
}

export function setup() {
  if (__ENV.K6_HTTP3_REQUIRE_MODULE === "1" && !http3) {
    throw new Error(
      "k6/x/http3 missing — use ./scripts/build-k6-http3.sh binary for HTTP/3 scenarios. See docs/XK6_HTTP3_SETUP.md",
    );
  }
}

const RAW_BASE = defaultRawBase();
const DUR = __ENV.DURATION || "2m";
const R1 = Number(__ENV.K6_H1_RATE || 8);
const R2 = Number(__ENV.K6_H2_RATE || 8);
const R3 = Number(__ENV.K6_H3_RATE || 5);
const SLEEP_MS = Number(__ENV.K6_REALISTIC_SLEEP_MS || 0);

function numEnv(name, def) {
  const v = __ENV[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const PRE_VU_H12 = numEnv("K6_PREALLOCATED_VUS", 40);
const MAX_VU_H12 = numEnv("K6_MAX_VUS", 200);
/** Lower defaults for H3: laptop Colima + QUIC avoids UDP/socket/NAT collapse (0 B / 100% failed before dial). */
const PRE_VU_H3 = numEnv("K6_REALISTIC_H3_PRE_VUS", 10);
const MAX_VU_H3 = numEnv("K6_REALISTIC_H3_MAX_VUS", 80);
const H3_ONLY =
  __ENV.K6_REALISTIC_H3_ONLY === "1" ||
  __ENV.K6_REALISTIC_H3_ONLY === "true" ||
  __ENV.K6_REALISTIC_H3_ONLY === "yes";

export const realistic_errors = new Rate("realistic_errors");

const scenarios = {};
if (!H3_ONLY) {
  scenarios.h1_realistic = {
    executor: "constant-arrival-rate",
    rate: R1,
    timeUnit: "1s",
    duration: DUR,
    preAllocatedVUs: PRE_VU_H12,
    maxVUs: MAX_VU_H12,
    exec: "runH1",
    startTime: "0s",
  };
  scenarios.h2_realistic = {
    executor: "constant-arrival-rate",
    rate: R2,
    timeUnit: "1s",
    duration: DUR,
    preAllocatedVUs: PRE_VU_H12,
    maxVUs: MAX_VU_H12,
    exec: "runH2",
    startTime: "5s",
  };
  scenarios.h3_realistic = {
    executor: "constant-arrival-rate",
    rate: R3,
    timeUnit: "1s",
    duration: DUR,
    preAllocatedVUs: PRE_VU_H3,
    maxVUs: MAX_VU_H3,
    exec: "runH3",
    startTime: "10s",
  };
} else {
  scenarios.h3_realistic = {
    executor: "constant-arrival-rate",
    rate: R3,
    timeUnit: "1s",
    duration: DUR,
    preAllocatedVUs: PRE_VU_H3,
    maxVUs: MAX_VU_H3,
    exec: "runH3",
    startTime: "0s",
  };
}

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.35"],
    realistic_errors: ["rate<0.40"],
  },
});

function suffix() {
  return `vu${__VU}_it${__ITER}_${Math.random().toString(36).slice(2, 11)}`;
}

function randomUserId() {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

function doSleep() {
  if (SLEEP_MS > 0) sleep(SLEEP_MS / 1000);
}

/**
 * @param {"http1"|"http2"|"http3"} mode
 * @param {string} method
 * @param {string} url
 * @param {string|null} body
 * @param {Record<string,string>} headers
 */
function requestWithProto(mode, method, url, body, headers) {
  const params = injectTraceparentIntoParams(
    mergeEdgeTlsWithProtocol(RAW_BASE, mode, {
      timeout: "45s",
      headers: headers,
    }),
  );
  if (mode === "http3" && http3) {
    if (method === "GET") return http3.get(url, params);
    return http3.post(url, body, params);
  }
  if (method === "GET") return http.get(url, params);
  if (method === "POST") return http.post(url, body, params);
  return http.request(method, url, body, params);
}

function pickAction() {
  const r = Math.random() * 100;
  if (r < 18) return "health";
  if (r < 38) return "search";
  if (r < 58) return "trust";
  if (r < 78) return "register_login";
  return "register_only";
}

function runForMode(mode) {
  const tagProto = mode === "http1" ? "h1" : mode === "http2" ? "h2" : "h3";
  const action = pickAction();
  const suf = suffix();
  let ok = true;

  if (action === "health") {
    const url = `${RAW_BASE}/api/healthz`;
    const res = requestWithProto(mode, "GET", url, null, {});
    ok =
      check(res, {
        health: (r) => r.status === 200,
      }) && ok;
  } else if (action === "search") {
    const url = `${RAW_BASE}/api/listings/search?q=k6_${encodeURIComponent(suf)}&limit=5`;
    const res = requestWithProto(mode, "GET", url, null, {});
    ok =
      check(res, {
        search: (r) => (r.status >= 200 && r.status < 300) || r.status === 404,
      }) && ok;
  } else if (action === "trust") {
    const url = `${RAW_BASE}/api/trust/reputation/${randomUserId()}`;
    const res = requestWithProto(mode, "GET", url, null, {});
    ok =
      check(res, {
        trust: (r) => (r.status >= 200 && r.status < 300) || r.status === 404,
      }) && ok;
  } else if (action === "register_login") {
    const email = `k6_${tagProto}_${suf}@loadtest.invalid`;
    const password = "K6TestPass!a1";
    const regUrl = `${RAW_BASE}/api/auth/register`;
    const regBody = JSON.stringify({ email: email, password: password });
    const regHeaders = { "Content-Type": "application/json" };
    const reg = requestWithProto(mode, "POST", regUrl, regBody, regHeaders);
    const regOk = reg.status === 201 || reg.status === 200;
    ok =
      check(reg, {
        register: (r) => regOk || r.status === 409,
      }) && ok;
    if (regOk) {
      const loginUrl = `${RAW_BASE}/api/auth/login`;
      const loginBody = JSON.stringify({ email: email, password: password });
      const login = requestWithProto(mode, "POST", loginUrl, loginBody, regHeaders);
      ok =
        check(login, {
          login: (r) => r.status === 200 && String(r.body || "").indexOf("token") !== -1,
        }) && ok;
    }
  } else {
    const email = `k6_${tagProto}_once_${suf}@loadtest.invalid`;
    const password = "K6TestPass!a1";
    const regUrl = `${RAW_BASE}/api/auth/register`;
    const regBody = JSON.stringify({ email: email, password: password });
    const regHeaders = { "Content-Type": "application/json" };
    const reg = requestWithProto(mode, "POST", regUrl, regBody, regHeaders);
    ok =
      check(reg, {
        register_only: (r) => r.status === 201 || r.status === 200 || r.status === 409,
      }) && ok;
  }

  realistic_errors.add(!ok);
  doSleep();
}

export function runH1() {
  runForMode("http1");
}
export function runH2() {
  runForMode("http2");
}
export function runH3() {
  runForMode("http3");
}

/** Unused when all traffic is scenario-driven; keeps `k6 run` without scenarios happy. */
export default function () {}
