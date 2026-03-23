/**
 * k6: API gateway health via edge (GET /api/healthz).
 *
 * Strict TLS: k6 HTTP uses Go's default trust (no params.tls). macOS → login keychain
 * (scripts/lib/trust-dev-root-ca-macos.sh or ./scripts/k6-exec-strict-edge.sh). Linux → SSL_CERT_FILE.
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
const VUS = Number(__ENV.VUS || 8);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    // Edge + Colima: sub-ms p50 is unrealistic; keep smoke meaningful without flaky failures
    http_req_duration: ["p(50)<250", "p(95)<500", "p(99)<1000", "p(100)<4000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/healthz`,
    mergeEdgeTls(RAW_BASE, {
      tags: { service: "api-gateway", name: "GatewayHealthz" },
      timeout: "15s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.05);
}
