/**
 * Listings concurrency: healthz + filtered search (validateSearchFilters).
 *
 * Scenarios (single active scenario per run):
 *   K6_LISTINGS_SCENARIO=vus (default) — ramping-vus burst (historical Phase D default).
 *   K6_LISTINGS_SCENARIO=arrival — ramping-arrival-rate (smoother RPS; closer to capacity testing).
 *
 * Also: scripts/load/k6-listings-ramp.js (search-only CAR, loose thresholds),
 *       scripts/load/k6-listings-limit-finder.js (CAR envelope until p99/error threshold).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-concurrency.js
 *   DURATION=45s VUS=20 k6 run ...
 *   K6_LISTINGS_SCENARIO=arrival k6 run ...
 *   K6_LISTINGS_PACE_MS=100 — sleep between iteration steps (default 80 vus / 50 arrival)
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "40s";
const MAX_VU = Math.min(50, Math.max(2, Number(__ENV.VUS || 10)));
const RAMP_LOW = Math.max(1, Math.floor(MAX_VU * 0.6));
const MODE = String(__ENV.K6_LISTINGS_SCENARIO || "vus").toLowerCase();
const PACE_SEC = Math.max(0, Number(__ENV.K6_LISTINGS_PACE_MS || (MODE === "arrival" ? 50 : 80)) / 1000);

const scenarioVus = {
  listings_concurrency: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "8s", target: RAMP_LOW },
      { duration: "24s", target: MAX_VU },
      { duration: "8s", target: 0 },
    ],
    gracefulRampDown: "5s",
  },
};

/** Ramping arrival-rate: moderate stages; tune with VUS as max preAllocated hint */
const scenarioArrival = {
  listings_concurrency_arrival: {
    executor: "ramping-arrival-rate",
    startRate: Math.max(3, Math.floor(MAX_VU * 1.5)),
    timeUnit: "1s",
    preAllocatedVUs: Math.min(80, Math.max(10, MAX_VU * 2)),
    maxVUs: Math.min(200, Math.max(30, MAX_VU * 6)),
    stages: [
      { duration: "10s", target: Math.max(5, Math.floor(MAX_VU * 0.8)) },
      { duration: "22s", target: MAX_VU * 2 },
      { duration: "8s", target: Math.max(8, Math.floor(MAX_VU * 1.2)) },
    ],
  },
};

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: MODE === "arrival" ? scenarioArrival : scenarioVus,
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<400", "p(99)<1000", "p(100)<5000"],
  },
};

export default function () {
  const h = http.get(
    `${BASE}/api/listings/healthz`,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "ListingsHealthz" },
      timeout: "15s",
    }),
  );
  check(h, { "health 200": (r) => r.status === 200 });

  const s = http.get(
    `${BASE}/api/listings/search?q=test&min_price=0&max_price=50000000`,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "ListingsSearchFiltered" },
      timeout: "20s",
    }),
  );
  check(s, { "search 200": (r) => r.status === 200 });

  if (PACE_SEC > 0) sleep(PACE_SEC);
}
