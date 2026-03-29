/**
 * Short gateway health load for collapse-smoke-h2-h3.sh — fail_rate < 1%, p95 < 800ms.
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
const VUS = Number(__ENV.VUS || 5);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<2000", "p(100)<5000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/healthz`,
    mergeEdgeTls(RAW_BASE, {
      tags: { service: "api-gateway", name: "GatewayCollapseSmoke" },
      timeout: "15s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.05);
}
