/**
 * k6: search-history + watchlist flows (booking-service via api-gateway).
 * Run against MetalLB edge or local gateway:
 *   k6 run scripts/load/k6-search-watchlist.js
 *   BASE_URL=https://off-campus-housing.local HOST=off-campus-housing.local RESOLVE_IP=1 k6 run -e TARGET_IP=<lb> ...
 *
 * Env: VUS, DURATION, BASE_URL, HOST, RESOLVE_IP (set to 1 with TARGET_IP for Host header + IP dial)
 */
import http from "k6/http";
import { check, sleep } from "k6";

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

export const options = {
  vus: Number(__ENV.VUS || 8),
  duration: __ENV.DURATION || "45s",
  thresholds: {
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<2000"],
  },
};

const base = __ENV.BASE_URL || "https://off-campus-housing.local";
const host = __ENV.HOST || "off-campus-housing.local";
const resolveIp = __ENV.RESOLVE_IP || "";

function hostHeaders() {
  return resolveIp ? { Host: host } : {};
}

export function setup() {
  const email = `k6-sw-${randomSuffix()}-${Date.now()}@example.com`;
  const password = "TestPass123!";
  const params = {
    headers: { "Content-Type": "application/json", ...hostHeaders() },
  };
  const registerRes = http.post(`${base}/api/auth/register`, JSON.stringify({ email, password }), params);
  check(registerRes, { "register 201": (r) => r.status === 201 });
  const token = registerRes.json("token");
  return { token };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
    ...hostHeaders(),
  };

  // 1) Record several search profiles (history)
  const q = `k6 search ${__ITER} ${randomSuffix()}`;
  const histRes = http.post(
    `${base}/api/booking/search-history`,
    JSON.stringify({
      query: q,
      minPriceCents: 80000 + (__ITER % 10) * 1000,
      maxPriceCents: 250000,
      maxDistanceKm: 3 + (__ITER % 5),
    }),
    { headers }
  );
  check(histRes, { "search-history 201": (r) => r.status === 201 });

  const listHist = http.get(`${base}/api/booking/search-history/list?limit=10`, { headers });
  check(listHist, { "search-history list 200": (r) => r.status === 200 });

  // 2) Watchlist: synthetic listing UUIDs (add → list → remove)
  const lid = `11111111-1111-1111-1111-${String(100000000000 + (__ITER % 999)).padStart(12, "0")}`;
  const addRes = http.post(
    `${base}/api/booking/watchlist/add`,
    JSON.stringify({ listingId: lid, source: "k6-search-watchlist" }),
    { headers }
  );
  check(addRes, { "watchlist add ok": (r) => r.status === 201 || r.status === 200 });

  const listW = http.get(`${base}/api/booking/watchlist/list`, { headers });
  check(listW, { "watchlist list 200": (r) => r.status === 200 });

  const remRes = http.post(
    `${base}/api/booking/watchlist/remove`,
    JSON.stringify({ listingId: lid }),
    { headers }
  );
  check(remRes, { "watchlist remove 200": (r) => r.status === 200 });

  sleep(0.3);
}
