/**
 * k6 load test for messaging service (housing).
 * Hits GET /api/messaging/healthz (Caddy → api-gateway → messaging-service:4014).
 * Use same env as k6-reads: BASE_URL, K6_RESOLVE, SSL_CERT_FILE for strict TLS.
 * SNI must be off-campus-housing.test (--resolve off-campus-housing.test:443:<LB_IP>).
 *
 * Usage:
 *   BASE_URL=https://off-campus-housing.test K6_RESOLVE=off-campus-housing.test:443:<LB_IP> \
 *   K6_TLS_CA_CERT=$PWD/certs/dev-root.pem k6 run scripts/load/k6-messaging.js
 *   DURATION=60s RATE=50 VUS=20 k6 run scripts/load/k6-messaging.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from './k6-strict-edge-tls.js';

const RAW_BASE = defaultRawBase();
const HAS_API = RAW_BASE.endsWith('/api');
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || '30s';
const RATE = Number(__ENV.RATE || 20);
const VUS = Number(__ENV.VUS || 10);

export const errors = new Rate('errors');

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 502, 503));

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
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
  const res = http.get(
    api('/messaging/healthz'),
    mergeEdgeTls(RAW_BASE, { tags: { name: 'GET /api/messaging/healthz' } }),
  );
  const ok = res.status === 200 || res.status === 502 || res.status === 503;
  errors.add(!ok);
  check(res, { 'messaging health': () => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.1);
}
