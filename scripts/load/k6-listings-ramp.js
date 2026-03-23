/**
 * Listings: ramping arrival-rate load against edge GET /api/listings/search
 * (matches services/listings-service HTTP /search — gateway strips /api/listings prefix).
 *
 * No strict thresholds — use for saturation / capacity curves (RPS vs p95).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-ramp.js
 */
import http from "k6/http";
import { sleep } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    listings_ramp: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 200,
      stages: [
        { duration: "2m", target: 10 },
        { duration: "2m", target: 25 },
        { duration: "2m", target: 50 },
        { duration: "2m", target: 75 },
      ],
    },
  },
  thresholds: {
    // intentionally loose — discovery mode
    http_req_failed: ["rate<0.5"],
  },
};

export default function () {
  const q = `ramp-${__VU}-${__ITER}-${Date.now()}`;
  http.get(
    `${BASE}/api/listings/search?q=${encodeURIComponent(q)}&smoke_free=0`,
    mergeEdgeTls(RAW_BASE, { tags: { name: "listings_search_ramp" }, timeout: "60s" }),
  );
  sleep(0.02);
}
