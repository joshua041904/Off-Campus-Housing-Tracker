/**
 * k6: listings HTTP (search + create) via api-gateway + JWT.
 * Env: BASE_URL, HOST, RESOLVE_IP, VUS, DURATION (same pattern as k6-booking.js).
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.1"],
    http_req_duration: ["p(50)<400", "p(95)<2000", "p(99)<4000", "p(100)<12000"],
  },
};

const base = __ENV.BASE_URL || "https://off-campus-housing.local";
const host = __ENV.HOST || "off-campus-housing.local";
const resolveIp = __ENV.RESOLVE_IP || "";

function hostHdr() {
  return resolveIp ? { Host: host } : {};
}

export function setup() {
  const email = `k6-listings-${Date.now()}@example.com`;
  const password = "TestPass123!";
  const params = { headers: { "Content-Type": "application/json", ...hostHdr() } };
  const reg = http.post(`${base}/api/auth/register`, JSON.stringify({ email, password }), params);
  check(reg, { "register 201": (r) => r.status === 201 });
  return { token: reg.json("token") };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
    ...hostHdr(),
  };

  const q = `k6-${__VU}-${__ITER}`;
  const s = http.get(`${base}/api/listings/search?q=${encodeURIComponent(q)}&smoke_free=0`, { headers });
  check(s, { "search 200": (r) => r.status === 200 });

  const from = new Date();
  from.setDate(from.getDate() + 14);
  const until = new Date(from);
  until.setMonth(until.getMonth() + 4);
  const create = http.post(
    `${base}/api/listings/create`,
    JSON.stringify({
      title: `k6 listing ${q}`,
      description: "load test",
      price_cents: 120000 + (__ITER % 50) * 100,
      smoke_free: true,
      pet_friendly: false,
      furnished: true,
      effective_from: from.toISOString().slice(0, 10),
      effective_until: until.toISOString().slice(0, 10),
      amenities: ["wifi"],
    }),
    { headers }
  );
  check(create, { "create 201": (r) => r.status === 201 });

  sleep(0.2);
}
