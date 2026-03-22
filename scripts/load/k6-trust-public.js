/**
 * k6: Trust public reputation (no JWT). GET /api/trust/reputation/:uuid
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
const DUR = __ENV.DURATION || "25s";
const VUS = Number(__ENV.VUS || 6);
const SAMPLE_USER = __ENV.TRUST_SAMPLE_USER || "00000000-0000-0000-0000-000000000001";

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<2000", "p(100)<5000"],
  },
};

export default function () {
  const r = http.get(
    `${BASE}/api/trust/reputation/${SAMPLE_USER}`,
    mergeEdgeTls(RAW_BASE, {
      tags: { service: "trust-service", name: "TrustReputation" },
      timeout: "15s",
    }),
  );
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.08);
}
