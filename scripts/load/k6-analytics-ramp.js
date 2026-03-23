/**
 * Analytics: ramping arrival-rate against public daily-metrics (no JWT).
 * Heavier than listings — slower ramp start.
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-analytics-ramp.js
 */
import http from "k6/http";
import { sleep } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");
const DATE = __ENV.ANALYTICS_DATE || new Date().toISOString().slice(0, 10);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    analytics_ramp: {
      executor: "ramping-arrival-rate",
      startRate: 2,
      timeUnit: "1s",
      preAllocatedVUs: 10,
      maxVUs: 120,
      stages: [
        { duration: "2m", target: 5 },
        { duration: "2m", target: 10 },
        { duration: "2m", target: 20 },
        { duration: "2m", target: 40 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.5"],
  },
};

export default function () {
  http.get(
    `${BASE}/api/analytics/daily-metrics?date=${encodeURIComponent(DATE)}`,
    mergeEdgeTls(RAW_BASE, { tags: { name: "analytics_daily_metrics_ramp" }, timeout: "120s" }),
  );
  sleep(0.05);
}
