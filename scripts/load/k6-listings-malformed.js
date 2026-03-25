/**
 * Malformed / abuse-style requests against listings HTTP edge paths.
 * Expects fast 400s (no DB work for bad UUID / bad filters on PR branch).
 *
 *   SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-malformed.js
 *
 * Prereq: listings-service with validation PR (or compatible 400 behavior).
 * Compare http_req_duration p95 vs scripts/load/k6-listings-health.js — invalid path should stay low.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

/** Count any HTTP status (incl. 4xx/5xx) as “response received” for k6 failure rate — avoids false fails on legacy clusters where some abuse cases still return 5xx. Prefer validation PR deployed: then most cases are 400. */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 599 }));

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE;
const DUMMY_USER = "550e8400-e29b-41d4-a716-446655440000";

const lat400 = new Trend("malformed_400_latency_ms", true);

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    malformed: {
      executor: "ramping-vus",
      startVUs: 2,
      stages: [
        { duration: "5s", target: 8 },
        { duration: "25s", target: 12 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "3s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    malformed_400_latency_ms: ["p(95)<500", "p(99)<1500"],
  },
};

/** Round-robin case index */
const cases = [
  {
    tag: "bad_uuid",
    fn: () =>
      http.get(
        `${BASE}/api/listings/listings/not-a-uuid-at-all`,
        mergeEdgeTls(RAW_BASE, { tags: { case: "bad_uuid" }, timeout: "10s" }),
      ),
  },
  {
    tag: "min_gt_max",
    fn: () =>
      http.get(
        `${BASE}/api/listings/search?min_price=500000&max_price=1000&q=`,
        mergeEdgeTls(RAW_BASE, { tags: { case: "min_gt_max" }, timeout: "10s" }),
      ),
  },
  {
    tag: "negative_min",
    fn: () =>
      http.get(
        `${BASE}/api/listings/search?min_price=-5&max_price=100`,
        mergeEdgeTls(RAW_BASE, { tags: { case: "negative_min" }, timeout: "10s" }),
      ),
  },
  {
    tag: "string_price",
    fn: () =>
      http.get(
        `${BASE}/api/listings/search?min_price=foo&max_price=bar`,
        mergeEdgeTls(RAW_BASE, { tags: { case: "string_price" }, timeout: "10s" }),
      ),
  },
  {
    tag: "huge_price",
    fn: () =>
      http.get(
        `${BASE}/api/listings/search?min_price=0&max_price=999999999999999999999`,
        mergeEdgeTls(RAW_BASE, { tags: { case: "huge_price" }, timeout: "10s" }),
      ),
  },
  {
    tag: "empty_post",
    fn: () =>
      http.post(
        `${BASE}/api/listings/create`,
        "{}",
        mergeEdgeTls(RAW_BASE, {
          tags: { case: "empty_post" },
          headers: {
            "Content-Type": "application/json",
            "x-user-id": DUMMY_USER,
          },
          timeout: "10s",
        }),
      ),
  },
];

export default function () {
  const idx = Math.floor(Math.random() * cases.length);
  const c = cases[idx];
  const res = c.fn();
  if (res.status === 400 || res.status === 422) {
    lat400.add(res.timings.duration);
  }
  check(res, {
    [`${c.tag} rejected without 5xx`]: (r) => r.status < 500,
    [`${c.tag} prefer 400 validation`]: (r) =>
      r.status === 400 || r.status === 404 || r.status === 422 || r.status === 401,
  });
  sleep(0.04);
}
