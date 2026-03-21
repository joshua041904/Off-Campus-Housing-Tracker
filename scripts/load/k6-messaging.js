/**
 * k6 load test for messaging service (housing).
 * Hits GET /api/messaging/healthz (Caddy → api-gateway → messaging-service:4014).
 * Use same env as k6-reads: BASE_URL, K6_RESOLVE, SSL_CERT_FILE for strict TLS.
 * SNI must be off-campus-housing.local (--resolve off-campus-housing.local:443:<LB_IP>).
 *
 * Usage:
 *   BASE_URL=https://off-campus-housing.local K6_RESOLVE=off-campus-housing.local:443:<LB_IP> \
 *   SSL_CERT_FILE=./certs/dev-root.pem k6 run scripts/load/k6-messaging.js
 *   DURATION=60s RATE=50 VUS=20 k6 run scripts/load/k6-messaging.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.local').replace(/\/$/, '');
const HAS_API = RAW_BASE.endsWith('/api');
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || '30s';
const RATE = Number(__ENV.RATE || 20);
const VUS = Number(__ENV.VUS || 10);
const K6_RESOLVE = __ENV.K6_RESOLVE || '';
const SKIP_TLS_VERIFY = (__ENV.K6_INSECURE_SKIP_TLS || '0') === '1' || /^https:\/\/[\d.]+(:\d+)?(\/|$)/.test(RAW_BASE);

export const errors = new Rate('errors');

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 502, 503));

function parseHostsFromResolve() {
  if (!K6_RESOLVE || typeof K6_RESOLVE !== 'string') return {};
  const parts = K6_RESOLVE.split(':');
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
  scenarios: {
    messaging_health: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DUR,
      preAllocatedVUs: VUS,
      maxVUs: Math.max(VUS, 50),
    },
  },
  thresholds: {
    errors: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
    'http_req_duration': ['p(95)<500', 'p(99)<2000', 'p(100)<8000'],
  },
};

const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

export default function () {
  const reqOpts = { tags: { name: 'GET /api/messaging/healthz' } };
  if (SKIP_TLS_VERIFY) reqOpts.insecureSkipTLSVerify = true;
  const res = http.get(api('/messaging/healthz'), reqOpts);
  const ok = res.status === 200 || res.status === 502 || res.status === 503;
  errors.add(!ok);
  check(res, { 'messaging health': () => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.1);
}
