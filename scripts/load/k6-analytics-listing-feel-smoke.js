/**
 * Optional Ollama path smoke (unauthenticated when gateway OPEN route is deployed).
 *   BASE_URL=https://off-campus-housing.test k6 run scripts/load/k6-analytics-listing-feel-smoke.js
 */
import http from "k6/http";
import { check } from "k6";

const base = (__ENV.BASE_URL || "https://off-campus-housing.test").replace(/\/$/, "");
const edgeHeaders = {
  "x-loadtest": "1",
  "Content-Type": "application/json",
  "x-suite": typeof __ENV.K6_X_SUITE === "string" && __ENV.K6_X_SUITE.trim() ? __ENV.K6_X_SUITE.trim() : "k6",
};

export const options = {
  vus: Number(__ENV.VUS || 3),
  duration: __ENV.DURATION || "15s",
};

export default function () {
  const payload = JSON.stringify({
    title: "k6 studio",
    description: "Cozy studio near library",
    price_cents: 88000,
    audience: "renter",
  });
  const res = http.post(`${base}/api/analytics/insights/listing-feel`, payload, {
    headers: edgeHeaders,
  });
  check(res, {
    "status 200": (r) => r.status === 200,
  });
}
