/**
 * k6: API gateway GET /api/healthz over HTTP/3 when built with xk6-http3 (k6/x/http3).
 * Stock k6 falls back to http.get (tagged fallback) — use with .k6-build/bin/k6-http3 for real QUIC.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

let http3 = null;
try {
  // Only present in k6-http3 binary (see scripts/build-k6-http3.sh)
  http3 = require("k6/x/http3");
} catch (_e) {
  http3 = null;
}

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "25s";
const VUS = Number(__ENV.VUS || 6);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<3000"],
  },
};

export default function () {
  const url = `${BASE}/api/healthz`;
  const params = mergeEdgeTls(RAW_BASE, {
    tags: {
      service: "api-gateway",
      name: http3 ? "GatewayHealthzH3" : "GatewayHealthzH3Fallback",
      k6_protocol: "http3",
    },
    timeout: "20s",
  });

  let r;
  if (http3) {
    r = http3.get(url, params);
  } else {
    r = http.get(url, params);
  }
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.05);
}
