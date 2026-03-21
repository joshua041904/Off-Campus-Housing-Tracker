/**
 * k6: booking-service health via edge GET /api/booking/healthz.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const RAW_BASE = (__ENV.BASE_URL || "https://off-campus-housing.local").replace(/\/$/, "");
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "20s";
const VUS = Number(__ENV.VUS || 6);
const K6_RESOLVE = __ENV.K6_RESOLVE || "";
const SKIP_TLS_VERIFY =
  (__ENV.K6_INSECURE_SKIP_TLS || "0") === "1" || /^https:\/\/[\d.]+(:\d+)?(\/|$)/.test(RAW_BASE);

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
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<800", "p(99)<3000", "p(100)<8000"],
  },
};

export default function () {
  const params = { tags: { service: "booking-service", name: "BookingHealthz" }, timeout: "12s" };
  if (SKIP_TLS_VERIFY) params.insecureSkipTLSVerify = true;
  const r = http.get(`${BASE}/api/booking/healthz`, params);
  check(r, { "200": (res) => res.status === 200 });
  sleep(0.05);
}
