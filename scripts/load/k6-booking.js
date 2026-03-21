import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "20s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(50)<200", "p(95)<1200", "p(99)<3000", "p(100)<10000"],
  },
};

const base = __ENV.BASE_URL || "https://off-campus-housing.local";
const host = __ENV.HOST || "off-campus-housing.local";
const resolveIp = __ENV.RESOLVE_IP || "";

function withHostParams() {
  if (!resolveIp) return {};
  return {
    headers: { Host: host },
  };
}

export function setup() {
  const email = `k6-booking-${Date.now()}@example.com`;
  const password = "TestPass123!";
  const params = {
    headers: { "Content-Type": "application/json", ...(resolveIp ? { Host: host } : {}) },
  };
  const registerRes = http.post(
    `${base}/api/auth/register`,
    JSON.stringify({ email, password }),
    params
  );
  check(registerRes, { "register status 201": (r) => r.status === 201 });
  const token = registerRes.json("token");
  return { token };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
    ...(resolveIp ? { Host: host } : {}),
  };

  const searchRes = http.post(
    `${base}/api/booking/search-history`,
    JSON.stringify({
      query: "k6 near campus",
      minPriceCents: 90000,
      maxPriceCents: 200000,
      maxDistanceKm: 8,
    }),
    { headers }
  );
  check(searchRes, { "search-history created": (r) => r.status === 201 });

  const listRes = http.get(`${base}/api/booking/search-history/list?limit=5`, { headers });
  check(listRes, { "search-history list ok": (r) => r.status === 200 });

  const addRes = http.post(
    `${base}/api/booking/watchlist/add`,
    JSON.stringify({
      listingId: "11111111-1111-1111-1111-111111111111",
      source: "k6",
    }),
    { headers }
  );
  check(addRes, { "watchlist add ok": (r) => r.status === 201 || r.status === 200 });

  const removeRes = http.post(
    `${base}/api/booking/watchlist/remove`,
    JSON.stringify({
      listingId: "11111111-1111-1111-1111-111111111111",
    }),
    { headers }
  );
  check(removeRes, { "watchlist remove ok": (r) => r.status === 200 });

  sleep(0.5);
}
