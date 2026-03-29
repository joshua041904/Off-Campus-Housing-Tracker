/**
 * Two parallel k6 scenarios (different exec functions) to probe cross-service / gateway interference.
 * Uses ramping-VUs only (no constant-arrival-rate — avoids iteration drops).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem DUAL_PAIR=messaging+listings k6 run scripts/perf/k6-dual-service-contention.js
 *
 * DUAL_PAIR options (comma or plus separated):
 *   messaging+listings | analytics+listings | booking+messaging | booking+listings | analytics+messaging
 *
 * Env:
 *   ANALYTICS_DATE — for analytics path (default: today UTC date)
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "../load/k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE;
const PAIR_RAW = (__ENV.DUAL_PAIR || "messaging+listings").replace(/,/g, "+");
const PARTS = PAIR_RAW.split("+").map((s) => s.trim().toLowerCase());
const ANALYTICS_DATE = __ENV.ANALYTICS_DATE || new Date().toISOString().slice(0, 10);

function pathFor(name) {
  switch (name) {
    case "messaging":
      return "/api/messaging/healthz";
    case "listings":
      return "/api/listings/healthz";
    case "analytics":
      return `/api/analytics/daily-metrics?date=${encodeURIComponent(ANALYTICS_DATE)}`;
    case "booking":
      return "/api/booking/healthz";
    default:
      return "/api/listings/healthz";
  }
}

if (PARTS.length !== 2) {
  throw new Error(`DUAL_PAIR must name exactly two services (got: ${PAIR_RAW})`);
}

const A = PARTS[0];
const B = PARTS[1];

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    dual_a: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 4 },
        { duration: "25s", target: 6 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "5s",
      exec: "dualA",
    },
    dual_b: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 4 },
        { duration: "25s", target: 6 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "5s",
      exec: "dualB",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<3000"],
  },
};

export function dualA() {
  const r = http.get(
    `${BASE}${pathFor(A)}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { dual: "a", service: A, name: `dual-${A}` },
      timeout: "20s",
    }),
  );
  check(r, { ok: (res) => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.06);
}

export function dualB() {
  const r = http.get(
    `${BASE}${pathFor(B)}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { dual: "b", service: B, name: `dual-${B}` },
      timeout: "20s",
    }),
  );
  check(r, { ok: (res) => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.06);
}
