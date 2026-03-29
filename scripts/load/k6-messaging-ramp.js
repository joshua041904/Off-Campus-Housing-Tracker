/**
 * Messaging: ramping arrival-rate against GET /api/messaging/healthz (edge).
 * Uses arrival-rate (not open-loop VU count) to measure throughput vs tail.
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-messaging-ramp.js
 */
import http from "k6/http";
import { sleep } from "k6";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const HAS_API = RAW_BASE.endsWith("/api");
const BASE = RAW_BASE.replace(/\/$/, "");
const api = (p) => `${BASE}${HAS_API ? "" : "/api"}${p}`;

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429, 503));

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    messaging_ramp: {
      executor: "ramping-arrival-rate",
      startRate: 8,
      timeUnit: "1s",
      preAllocatedVUs: 25,
      maxVUs: 200,
      stages: [
        { duration: "90s", target: 20 },
        { duration: "90s", target: 45 },
        { duration: "90s", target: 80 },
        { duration: "90s", target: 120 },
      ],
    },
  },
  thresholds: {
    // 503 excluded via setResponseCallback — threshold targets TCP/EOF/5xx collapse, not bounded overload.
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  http.get(
    api("/messaging/healthz"),
    mergeEdgeTls(RAW_BASE, { tags: { name: "messaging_health_ramp" }, timeout: "30s" }),
  );
  sleep(0.02);
}
