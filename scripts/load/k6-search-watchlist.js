/**
 * k6: search-history + watchlist flows (booking-service via api-gateway).
 * Requires: BASE_URL=https://… (pass -e from run-housing-k6-edge-smoke.sh), SSL_CERT_FILE=./certs/dev-root.pem
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

const BASE_URL = defaultRawBase();

export const options = {
  ...strictEdgeTlsOptions(BASE_URL),
  vus: Number(__ENV.VUS || 8),
  duration: __ENV.DURATION || "45s",
  thresholds: {
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<2000"],
  },
};

export function setup() {
  const email = `k6-sw-${randomSuffix()}-${Date.now()}@example.com`;
  const password = "TestPass123!";
  const params = mergeEdgeTls(BASE_URL, {
    headers: { "Content-Type": "application/json" },
  });
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({ email, password }), params);
  check(registerRes, { "register 201": (r) => r.status === 201 });
  const token = registerRes.json("token");
  return { token };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
  };

  const q = `k6 search ${__ITER} ${randomSuffix()}`;
  const histRes = http.post(
    `${BASE_URL}/api/booking/search-history`,
    JSON.stringify({
      query: q,
      minPriceCents: 80000 + (__ITER % 10) * 1000,
      maxPriceCents: 250000,
      maxDistanceKm: 3 + (__ITER % 5),
    }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(histRes, { "search-history 201": (r) => r.status === 201 });

  const listHist = http.get(
    `${BASE_URL}/api/booking/search-history/list?limit=10`,
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(listHist, { "search-history list 200": (r) => r.status === 200 });

  const lid = `11111111-1111-1111-1111-${String(100000000000 + (__ITER % 999)).padStart(12, "0")}`;
  const addRes = http.post(
    `${BASE_URL}/api/booking/watchlist/add`,
    JSON.stringify({ listingId: lid, source: "k6-search-watchlist" }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(addRes, { "watchlist add ok": (r) => r.status === 201 || r.status === 200 });

  const listW = http.get(`${BASE_URL}/api/booking/watchlist/list`, mergeEdgeTls(BASE_URL, { headers }));
  check(listW, { "watchlist list 200": (r) => r.status === 200 });

  const remRes = http.post(
    `${BASE_URL}/api/booking/watchlist/remove`,
    JSON.stringify({ listingId: lid }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(remRes, { "watchlist remove 200": (r) => r.status === 200 });

  sleep(0.3);
}
