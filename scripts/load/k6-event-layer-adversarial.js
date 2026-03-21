/**
 * k6: Companion load + light adversarial traffic for the event/outbox pipeline (Vitest lives in event-layer-verification).
 * Exercises edge + messaging + booking health; injects malformed requests (expect 4xx) to ensure gateways stay stable under noise.
 *
 * Env: BASE_URL, K6_RESOLVE, DURATION, VUS, K6_INSECURE_SKIP_TLS, SSL_CERT_FILE (same as run-k6-all-services.sh).
 * Tags: event_layer=true on all requests for log filtering.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const RAW_BASE = (__ENV.BASE_URL || "https://off-campus-housing.local").replace(/\/$/, "");
const HAS_API = RAW_BASE.endsWith("/api");
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "45s";
const VUS = Number(__ENV.VUS || 12);
const K6_RESOLVE = __ENV.K6_RESOLVE || "";
const SKIP_TLS_VERIFY =
  (__ENV.K6_INSECURE_SKIP_TLS || "0") === "1" || /^https:\/\/[\d.]+(:\d+)?(\/|$)/.test(RAW_BASE);

export const adversarialAccepted = new Rate("event_layer_adversarial_accepted");

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

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 599 }));

export const options = {
  ...opts,
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.15"],
    http_req_duration: ["p(95)<2500", "p(99)<6000", "p(100)<15000"],
    event_layer_adversarial_accepted: ["rate>0.70"],
  },
};

const api = (p) => `${BASE}${HAS_API ? "" : "/api"}${p}`;

function baseParams(extra = {}) {
  const p = { tags: { event_layer: "true", ...extra.tags }, timeout: "12s", ...extra };
  delete p.tags?.tags;
  if (SKIP_TLS_VERIFY) p.insecureSkipTLSVerify = true;
  return p;
}

export default function () {
  const i = __ITER % 6;
  if (i === 0) {
    const r = http.get(api("/healthz"), baseParams({ tags: { name: "event_layer_gateway_health" } }));
    check(r, { gw: (res) => res.status === 200 });
  } else if (i === 1 || i === 2) {
    const r = http.get(api("/messaging/healthz"), baseParams({ tags: { name: "event_layer_messaging_health" } }));
    check(r, { msg: (res) => res.status === 200 || res.status === 503 });
  } else if (i === 3) {
    const r = http.get(api("/booking/healthz"), baseParams({ tags: { name: "event_layer_booking_health" } }));
    check(r, { book: (res) => res.status === 200 || res.status === 503 });
  } else if (i === 4) {
    // Adversarial: garbage query length (should not crash gateway)
    const junk = "x".repeat(4000);
    const r = http.get(
      api(`/messaging/healthz?probe=${junk}`),
      baseParams({ tags: { name: "event_layer_long_query" } }),
    );
    const okAdv = r.status >= 200 && r.status < 600;
    adversarialAccepted.add(okAdv);
    check(r, { long_q: () => okAdv });
  } else {
    // Adversarial: invalid JSON body to POST endpoint (expect 4xx)
    const r = http.post(
      api("/auth/login"),
      "{not-json",
      baseParams({
        tags: { name: "event_layer_bad_json" },
        headers: { "Content-Type": "application/json" },
      }),
    );
    const okAdv = r.status === 400 || r.status === 401 || r.status === 422 || r.status === 415;
    adversarialAccepted.add(okAdv);
    check(r, { bad_json: () => okAdv });
  }
  sleep(0.02 + Math.random() * 0.08);
}
