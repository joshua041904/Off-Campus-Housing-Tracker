/**
 * Listings capacity envelope: ramping-arrival-rate until p99 or error rate breaks thresholds.
 * Pairs with k6-messaging-limit-finder.js (messaging CAR) and k6-listings-concurrency.js (VU ramp).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-limit-finder.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");

const errors = new Rate("errors");

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    listings_ramp_find: {
      executor: "ramping-arrival-rate",
      startRate: 4,
      timeUnit: "1s",
      stages: [
        { target: 10, duration: "30s" },
        { target: 20, duration: "30s" },
        { target: 40, duration: "30s" },
        { target: 60, duration: "30s" },
      ],
      preAllocatedVUs: 15,
      maxVUs: 120,
    },
  },
  thresholds: {
    errors: ["rate<0.02"],
    http_req_duration: ["p(99)<800"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const h = http.get(
    `${BASE}/api/listings/healthz`,
    mergeEdgeTls(RAW_BASE, { tags: { name: "listings_lf_health" }, timeout: "15s" }),
  );
  const s = http.get(
    `${BASE}/api/listings/search?q=limit-find-${__VU}-${__ITER}&min_price=0&max_price=50000000`,
    mergeEdgeTls(RAW_BASE, { tags: { name: "listings_lf_search" }, timeout: "45s" }),
  );
  const ok = h.status === 200 && s.status === 200;
  errors.add(!ok);
  check(h, { health: (r) => r.status === 200 });
  check(s, { search: (r) => r.status === 200 });
  sleep(0.12);
}
