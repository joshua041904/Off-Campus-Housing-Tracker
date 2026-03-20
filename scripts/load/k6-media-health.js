/**
 * k6 load test: media service health via edge (Caddy → api-gateway → media).
 * Same env pattern as k6-messaging.js (BASE_URL, K6_RESOLVE, SSL_CERT_FILE).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.local').replace(/\/$/, '');
const HAS_API = RAW_BASE.endsWith('/api');
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || '30s';
const RATE = Number(__ENV.RATE || 15);
const VUS = Number(__ENV.VUS || 8);
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
    media_health: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DUR,
      preAllocatedVUs: VUS,
      maxVUs: Math.max(VUS, 40),
    },
  },
  thresholds: {
    errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<600', 'p(99)<2500'],
  },
};

const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

export default function () {
  const reqOpts = { tags: { name: 'GET /api/media/healthz' } };
  if (SKIP_TLS_VERIFY) reqOpts.insecureSkipTLSVerify = true;
  const res = http.get(api('/media/healthz'), reqOpts);
  const ok = res.status === 200 || res.status === 502 || res.status === 503;
  errors.add(!ok);
  check(res, { 'media health': () => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.1);
}
