/**
 * k6: Analytics POST /api/analytics/insights/listing-feel (no JWT; hits Ollama when OLLAMA_BASE_URL is set on analytics-service).
 * Slow when Ollama is cold — use low VUs and long timeout.
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
const DUR = __ENV.DURATION || "30s";
const VUS = Number(__ENV.VUS || 2);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.15"],
    http_req_duration: ["p(95)<120000", "p(99)<180000"],
  },
};

const payload = JSON.stringify({
  title: "k6 load 2BR near campus",
  description: "Quiet, laundry, cat ok",
  price_cents: 110000,
  audience: "renter",
});

export default function () {
  const r = http.post(
    `${BASE}/api/analytics/insights/listing-feel`,
    payload,
    mergeEdgeTls(RAW_BASE, {
      tags: { service: "analytics-service", name: "AnalyticsListingFeel" },
      timeout: "110s",
      headers: { "Content-Type": "application/json" },
    }),
  );
  let body = {};
  try {
    body = r.json() || {};
  } catch {
    /* ignore */
  }
  check(r, {
    "200": (res) => res.status === 200,
    "analysis or model field": () =>
      Boolean(body && (body.analysis_text || body.model_used)),
  });
  sleep(0.5);
}
