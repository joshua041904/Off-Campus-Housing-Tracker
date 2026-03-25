/**
 * Per-service concurrency probe: listings (ramping-VUs, not constant-arrival-rate).
 * Health + public search with min/max filters (exercises validateSearchFilters on PR branch).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-concurrency.js
 *   DURATION=45s k6 run ...  (extends sustain stage)
 *   VUS=20 k6 run ...  (max ramp target; default 10)
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

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
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
  },
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

  sleep(0.08);
}
