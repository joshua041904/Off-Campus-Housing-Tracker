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

/** Same as defaultRawBase(); try/catch so this script runs if an older k6-strict-edge-tls.js still throws when BASE_URL is unset. */
function rawBaseOrDefault() {
  try {
    return defaultRawBase();
  } catch {
    const b =
      typeof __ENV.BASE_URL === "string" && __ENV.BASE_URL.startsWith("https://")
        ? __ENV.BASE_URL
        : "https://off-campus-housing.test";
    return b.replace(/\/$/, "");
  }
}

const RAW_BASE = rawBaseOrDefault();
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
