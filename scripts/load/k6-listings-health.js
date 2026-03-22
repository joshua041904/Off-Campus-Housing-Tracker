/**
 * k6: listings-service health via edge GET /api/listings/healthz.
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
const DUR = __ENV.DURATION || "20s";
const VUS = Number(__ENV.VUS || 6);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<600", "p(99)<2500", "p(100)<8000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/listings/healthz`,
    mergeEdgeTls(RAW_BASE, { tags: { service: "listings-service", name: "ListingsHealthz" }, timeout: "12s" }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.05);
}
