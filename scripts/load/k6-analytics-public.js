/**
 * k6: Analytics public daily-metrics (no JWT).
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
const DUR = __ENV.DURATION || "25s";
const VUS = Number(__ENV.VUS || 6);
const DATE = __ENV.ANALYTICS_DATE || new Date().toISOString().slice(0, 10);

function numEnv(name, def) {
  const v = __ENV[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
/** Default 0.05; preflight-lab exports K6_ANALYTICS_PUBLIC_MAX_FAIL_RATE≈0.2 under load (Kafka strict paths). */
const failMax = numEnv("K6_ANALYTICS_PUBLIC_MAX_FAIL_RATE", 0.05);

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: [`rate<${failMax}`],
    http_req_duration: ["p(95)<1200", "p(99)<4000", "p(100)<8000"],
  },
});

export default function () {
  const r = http.get(
    `${BASE}/api/analytics/daily-metrics?date=${encodeURIComponent(DATE)}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { service: "analytics-service", name: "AnalyticsDailyMetrics" },
      timeout: "20s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.08);
}
