/**
 * k6: Trust public reputation (no JWT). GET /api/trust/reputation/:uuid
 */
import http from "k6/http";
import { check, sleep } from "k6";

const RAW_BASE = (__ENV.BASE_URL || "https://off-campus-housing.local").replace(/\/$/, "");
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "25s";
const VUS = Number(__ENV.VUS || 6);
const K6_RESOLVE = __ENV.K6_RESOLVE || "";
const SKIP_TLS_VERIFY =
  (__ENV.K6_INSECURE_SKIP_TLS || "0") === "1" || /^https:\/\/[\d.]+(:\d+)?(\/|$)/.test(RAW_BASE);
const SAMPLE_USER = __ENV.TRUST_SAMPLE_USER || "00000000-0000-0000-0000-000000000001";

function parseHostsFromResolve() {
  if (!K6_RESOLVE || typeof K6_RESOLVE !== "string") return {};
  const parts = K6_RESOLVE.split(":");
  if (parts.length < 3) return {};
  const host = parts[0];
  const ip = parts[parts.length - 1];
  if (!host || !ip) return {};
  return { [host]: ip };
}

const hosts = parseHostsFromResolve();
const opts = Object.keys(hosts).length ? { hosts } : {};

export const options = {
  ...opts,
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<2000", "p(100)<5000"],
  },
};

export default function () {
  const params = {
    tags: { service: "trust-service", name: "TrustReputation" },
    timeout: "15s",
  };
  if (SKIP_TLS_VERIFY) params.insecureSkipTLSVerify = true;
  const r = http.get(`${BASE}/api/trust/reputation/${SAMPLE_USER}`, params);
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.08);
}
