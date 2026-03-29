/**
 * Per-service concurrency probe: trust public reputation (ramping-VUs).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-trust-concurrency.js
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
const SAMPLE_USER =
  __ENV.TRUST_SAMPLE_USER || "00000000-0000-0000-0000-000000000001";

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    trust_concurrency: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "8s", target: 5 },
        { duration: "24s", target: 8 },
        { duration: "8s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<3000", "p(100)<8000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/trust/reputation/${SAMPLE_USER}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "TrustReputationConcurrent" },
      timeout: "15s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.08);
}
