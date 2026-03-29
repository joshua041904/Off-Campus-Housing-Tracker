/**
 * Smoke: public GET daily-metrics through edge (HTTP/2 or HTTP/3 per k6 / TLS setup).
 * Usage:
 *   BASE_URL=https://off-campus-housing.test k6 run scripts/load/k6-analytics-daily-smoke.js
 */
import http from "k6/http";
import { check } from "k6";

const base = (__ENV.BASE_URL || "https://off-campus-housing.test").replace(/\/$/, "");

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "20s",
};

export default function () {
  const d = new Date().toISOString().slice(0, 10);
  const url = `${base}/api/analytics/daily-metrics?date=${encodeURIComponent(d)}`;
  const res = http.get(url);
  check(res, {
    "status 200": (r) => r.status === 200,
  });
}
