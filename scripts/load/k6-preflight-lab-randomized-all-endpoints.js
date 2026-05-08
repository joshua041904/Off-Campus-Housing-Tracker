/**
 * Preflight-lab k6: one VU loop that **randomly** picks among edge routes for **every** housing service
 * (health + key public reads + register/login with unique emails + analytics daily + optional listing-feel).
 *
 * Intended for `make preflight-lab` (PREFLIGHT_LAB=1) via run-housing-k6-edge-smoke.sh — avoids fixed cache keys
 * by varying query strings, UUIDs, dates, and JSON bodies every iteration.
 *
 * Env: BASE_URL, SSL_CERT_FILE / K6_TLS_CA_CERT (see k6-strict-edge-tls.js), DURATION, VUS
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";
import { injectTraceparentIntoParams } from "./k6-w3c-traceparent.js";

const RAW_BASE = defaultRawBase();
const HAS_API = RAW_BASE.endsWith("/api");
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "120s";
const VUS = Number(__ENV.VUS || 10);

function numEnv(name, def) {
  const v = __ENV[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
/** Under CPU/Kafka pressure many routes return 4xx/5xx quickly; tighten via K6_PREFLIGHT_LAB_* for CI. */
const labHttpFailMax = numEnv("K6_PREFLIGHT_LAB_HTTP_REQ_FAILED_MAX", 0.92);
const labCustomErrMax = numEnv("K6_PREFLIGHT_LAB_ERRORS_MAX", 0.88);

export const lab_errors = new Rate("preflight_lab_errors");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 599 }));

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: [`rate<${labHttpFailMax}`],
    preflight_lab_errors: [`rate<${labCustomErrMax}`],
  },
});

function api(p) {
  const prefix = HAS_API ? "" : "/api";
  return `${BASE}${prefix}${p}`;
}

function rnd() {
  return Math.random().toString(36).slice(2, 12);
}

function rndUuid() {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return s;
}

function params(name, extra) {
  return injectTraceparentIntoParams(
    mergeEdgeTls(RAW_BASE, Object.assign({ tags: { name: name, preflight_lab: "1" }, timeout: "25s" }, extra || {})),
  );
}

function ok2xx(r) {
  return r.status >= 200 && r.status < 300;
}

function okHealth(r) {
  return r.status === 200 || r.status === 502 || r.status === 503;
}

export default function () {
  const u = rndUuid();
  const s = `vu${__VU}_it${__ITER}_${rnd()}`;
  const roll = Math.floor(Math.random() * 22);
  let ok = true;

  if (roll === 0) {
    const r = http.get(api("/healthz"), params("lab_gateway_health"));
    ok = check(r, { h: ok2xx }) && ok;
  } else if (roll === 1) {
    const r = http.get(api("/readyz"), params("lab_gateway_readyz"));
    ok = check(r, { r: (res) => res.status === 200 || res.status === 503 }) && ok;
  } else if (roll === 2) {
    const r = http.get(api("/auth/healthz"), params("lab_auth_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 3) {
    const email = `lab_${s}@loadtest.invalid`;
    const body = JSON.stringify({ email: email, password: "LabK6Pass!9z" });
    const r = http.post(api("/auth/register"), body, params("lab_auth_register", { headers: { "Content-Type": "application/json" } }));
    ok = check(r, { reg: (res) => res.status === 201 || res.status === 200 || res.status === 409 }) && ok;
  } else if (roll === 4) {
    const email = `lab_login_${s}@loadtest.invalid`;
    const pw = "LabK6Pass!9z";
    const reg = http.post(
      api("/auth/register"),
      JSON.stringify({ email: email, password: pw }),
      params("lab_auth_reg_for_login", { headers: { "Content-Type": "application/json" } }),
    );
    if (reg.status === 201 || reg.status === 200) {
      const r = http.post(
        api("/auth/login"),
        JSON.stringify({ email: email, password: pw }),
        params("lab_auth_login", { headers: { "Content-Type": "application/json" } }),
      );
      ok = check(r, { login: (res) => res.status === 200 && String(res.body || "").indexOf("token") !== -1 }) && ok;
    } else {
      ok = check(reg, { skip: () => true }) && ok;
    }
  } else if (roll === 5) {
    const r = http.get(api(`/listings/search?q=${encodeURIComponent("lab " + s)}&limit=${3 + (__ITER % 5)}`), params("lab_listings_search"));
    ok = check(r, { search: (res) => ok2xx(res) || res.status === 404 }) && ok;
  } else if (roll === 6) {
    const r = http.get(api("/listings/healthz"), params("lab_listings_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 7) {
    const r = http.get(api(`/listings/listings/${u}`), params("lab_listings_get"));
    ok = check(r, { g: (res) => ok2xx(res) || res.status === 404 }) && ok;
  } else if (roll === 8) {
    const r = http.get(api(`/listings?cb=${encodeURIComponent(s)}`), params("lab_listings_index"));
    ok = check(r, { idx: (res) => ok2xx(res) || res.status === 404 }) && ok;
  } else if (roll === 9) {
    const r = http.get(api("/booking/healthz"), params("lab_booking_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 10) {
    const r = http.get(api("/messaging/healthz"), params("lab_messaging_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 11) {
    const r = http.get(api("/trust/healthz"), params("lab_trust_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 12) {
    const r = http.get(api(`/trust/reputation/${u}`), params("lab_trust_reputation"));
    ok = check(r, { t: (res) => ok2xx(res) || res.status === 404 }) && ok;
  } else if (roll === 13) {
    const r = http.get(api("/analytics/healthz"), params("lab_analytics_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 14) {
    const dayOff = (__ITER % 40) - 20;
    const d = new Date();
    d.setDate(d.getDate() + dayOff);
    const ds = d.toISOString().slice(0, 10);
    const r = http.get(
      api(`/analytics/daily-metrics?date=${encodeURIComponent(ds)}&_=${encodeURIComponent(s)}`),
      params("lab_analytics_daily"),
    );
    ok = check(r, { m: (res) => res.status === 200 || res.status === 404 || res.status === 503 }) && ok;
  } else if (roll === 15) {
    const payload = JSON.stringify({
      title: `lab-${s}`,
      description: `Desc ${rnd()} near ${rnd()}`,
      price_cents: 50000 + (__ITER % 20000),
      audience: __ITER % 2 === 0 ? "renter" : "buyer",
    });
    const r = http.post(api("/analytics/insights/listing-feel"), payload, params("lab_listing_feel", { headers: { "Content-Type": "application/json" } }));
    ok = check(r, { feel: (res) => res.status === 200 || res.status === 400 || res.status === 503 || res.status === 502 }) && ok;
  } else if (roll === 16) {
    const r = http.get(api("/media/healthz"), params("lab_media_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 17) {
    const r = http.get(api("/notification/healthz"), params("lab_notification_health"));
    ok = check(r, { h: okHealth }) && ok;
  } else if (roll === 18) {
    const junk = "q" + rnd() + "=" + rnd();
    const r = http.get(api(`/messaging/healthz?${junk}`), params("lab_messaging_noise"));
    ok = check(r, { n: (res) => res.status >= 200 && res.status < 600 }) && ok;
  } else if (roll === 19) {
    const r = http.post(api("/auth/login"), "{bad-json-" + s, params("lab_bad_json", { headers: { "Content-Type": "application/json" } }));
    ok = check(r, { bad: (res) => res.status >= 400 && res.status < 500 }) && ok;
  } else if (roll === 20) {
    const r = http.get(api(`/healthz?cb=${encodeURIComponent(s)}`), params("lab_healthz_bust"));
    ok = check(r, { h: ok2xx }) && ok;
  } else {
    const r = http.get(api(`/auth/healthz?probe=${encodeURIComponent(s)}`), params("lab_auth_health_bust"));
    ok = check(r, { h: okHealth }) && ok;
  }

  lab_errors.add(!ok);
  sleep(0.02 + Math.random() * 0.06);
}
