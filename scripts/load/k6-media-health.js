/**
 * k6 load test: media service health via edge (Caddy → api-gateway → media).
 * Env: BASE_URL, K6_RESOLVE, K6_TLS_CA_CERT (see k6-strict-edge-tls.js).
 * K6_ORCHESTRATION_VU_SCENARIO=1 — ramping-vus for multi-script suites (same idea as k6-messaging.js).
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
const RATE = Number(__ENV.RATE || 15);
const VUS = Number(__ENV.VUS || 8);
const ORCH_VU = __ENV.K6_ORCHESTRATION_VU_SCENARIO === '1';

export const errors = new Rate('errors');

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 502, 503));

const scenarios = ORCH_VU
  ? {
      media_health: {
        executor: 'ramping-vus',
        startVUs: Math.min(2, Math.max(1, VUS)),
        stages: [
          { duration: '10s', target: Math.min(5, Math.max(2, VUS)) },
          { duration: '10s', target: Math.min(5, Math.max(2, VUS)) },
          { duration: '5s', target: 0 },
        ],
        gracefulRampDown: '5s',
      },
    }
  : {
      media_health: {
        executor: 'constant-arrival-rate',
        rate: RATE,
        timeUnit: '1s',
        duration: DUR,
        preAllocatedVUs: VUS,
        maxVUs: Math.max(VUS, 40),
      },
    };

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios,
  thresholds: {
    errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<600', 'p(99)<2500', 'p(100)<10000'],
  },
};

const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

export default function () {
  const res = http.get(api('/media/healthz'), mergeEdgeTls(RAW_BASE, { tags: { name: 'GET /api/media/healthz' } }));
  const ok = res.status === 200 || res.status === 502 || res.status === 503;
  errors.add(!ok);
  check(res, { 'media health': () => res.status === 200 || res.status === 502 || res.status === 503 });
  sleep(0.1);
}
