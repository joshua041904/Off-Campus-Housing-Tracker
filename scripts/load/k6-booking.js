import http from "k6/http";
import { check, sleep } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const BASE_URL = defaultRawBase();

export const options = {
  ...strictEdgeTlsOptions(BASE_URL),
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "20s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(50)<200", "p(95)<1200", "p(99)<3000", "p(100)<10000"],
  },
};

export function setup() {
  const email = `k6-booking-${Date.now()}@example.com`;
  const password = "TestPass123!";
  const params = mergeEdgeTls(BASE_URL, {
    headers: { "Content-Type": "application/json" },
  });
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password }),
    params,
  );
  check(registerRes, { "register status 201": (r) => r.status === 201 });
  const token = registerRes.json("token");
  return { token };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
  };

  const searchRes = http.post(
    `${BASE_URL}/api/booking/search-history`,
    JSON.stringify({
      query: "k6 near campus",
      minPriceCents: 90000,
      maxPriceCents: 200000,
      maxDistanceKm: 8,
    }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(searchRes, { "search-history created": (r) => r.status === 201 });

  const listRes = http.get(
    `${BASE_URL}/api/booking/search-history/list?limit=5`,
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(listRes, { "search-history list ok": (r) => r.status === 200 });

  const addRes = http.post(
    `${BASE_URL}/api/booking/watchlist/add`,
    JSON.stringify({
      listingId: "11111111-1111-1111-1111-111111111111",
      source: "k6",
    }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(addRes, { "watchlist add ok": (r) => r.status === 201 || r.status === 200 });

  const removeRes = http.post(
    `${BASE_URL}/api/booking/watchlist/remove`,
    JSON.stringify({
      listingId: "11111111-1111-1111-1111-111111111111",
    }),
    mergeEdgeTls(BASE_URL, { headers }),
  );
  check(removeRes, { "watchlist remove ok": (r) => r.status === 200 });

  sleep(0.5);
}
