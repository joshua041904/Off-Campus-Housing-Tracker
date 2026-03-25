/**
 * Per-service concurrency probe: messaging health (ramping-VUs).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-messaging-concurrency.js
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

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    messaging_concurrency: {
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
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<500", "p(99)<2000", "p(100)<6000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/messaging/healthz`,
    mergeEdgeTls(RAW_BASE, {
      tags: { name: "MessagingHealthz" },
      timeout: "15s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.08);
}
