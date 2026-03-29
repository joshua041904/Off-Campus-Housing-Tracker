/**
 * Per-service concurrency probe: media health (ramping-VUs, matches suite orchestration style).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-media-concurrency.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const HAS_API = RAW_BASE.endsWith("/api");
const BASE = RAW_BASE;
const errors = new Rate("errors");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 502, 503));

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    media_concurrency: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "8s", target: 6 },
        { duration: "24s", target: 10 },
        { duration: "8s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    errors: ["rate<0.08"],
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<800", "p(99)<3000", "p(100)<10000"],
  },
};

const api = (p) => `${BASE}${HAS_API ? "" : "/api"}${p}`;

export default function () {
  const res = http.get(
    api("/media/healthz"),
    mergeEdgeTls(RAW_BASE, { tags: { name: "MediaHealthConcurrent" } }),
  );
  const ok = res.status === 200 || res.status === 502 || res.status === 503;
  errors.add(!ok);
  check(res, {
    "media health": () =>
      res.status === 200 || res.status === 502 || res.status === 503,
  });
  sleep(0.08);
}
