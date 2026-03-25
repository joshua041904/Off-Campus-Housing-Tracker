/**
 * Per-service concurrency probe: analytics public path (ramping-VUs).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-analytics-concurrency.js
 *   ANALYTICS_DATE=2025-01-01 k6 run ...
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
const DATE = __ENV.ANALYTICS_DATE || new Date().toISOString().slice(0, 10);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    analytics_concurrency: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "8s", target: 4 },
        { duration: "24s", target: 6 },
        { duration: "8s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1500", "p(99)<4000", "p(100)<10000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/analytics/daily-metrics?date=${encodeURIComponent(DATE)}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "AnalyticsDailyMetrics" },
      timeout: "25s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.1);
}
