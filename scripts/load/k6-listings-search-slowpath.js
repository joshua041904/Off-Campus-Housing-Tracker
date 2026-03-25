/**
 * Slow-path / worst-case listings public search (ILIKE + wide price band).
 * Use after healthy concurrency passes — identifies SQL sort/scan weakness.
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-search-slowpath.js
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

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    listings_slowpath: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10s", target: 4 },
        { duration: "30s", target: 6 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000", "p(99)<8000", "p(100)<20000"],
  },
};

export default function () {
  const wideQ =
    "slowpath+" +
    "x".repeat(Number(__ENV.SLOWPATH_Q_PAD || 48)) +
    "+apartment+rent";
  const url = `${BASE}/api/listings/search?q=${encodeURIComponent(wideQ)}&min_price=0&max_price=999999999&smoke_free=1`;
  const s = http.get(
    url,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "ListingsSearchSlowpath" },
      timeout: "30s",
    }),
  );
  check(s, { "search ok": (r) => r.status === 200 });
  sleep(0.15);
}
