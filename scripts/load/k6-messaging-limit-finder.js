/**
 * Limit finder: ramping-arrival-rate until P99 > 500ms or error rate > 2%.
 * Defines safe capacity envelope. Use after E2E flow works.
 *
 * Usage: BASE_URL=... K6_RESOLVE=... SSL_CERT_FILE=... k6 run scripts/load/k6-messaging-limit-finder.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const BASE = RAW_BASE;

// 503 = bounded overload (messaging concurrency guard / edge) — not TCP collapse; keep out of http_req_failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429, 503));

export const errors = new Rate('errors');

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    ramp_up: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      stages: [
        { target: 10, duration: '30s' },
        { target: 20, duration: '30s' },
        { target: 40, duration: '30s' },
        { target: 80, duration: '30s' },
      ],
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: {
    errors: ['rate<0.02'],
    http_req_duration: ['p(99)<500'],
    http_req_failed: ['rate<0.02'],
  },
};

export default function () {
  const res = http.get(
    `${BASE}/api/messaging/healthz`,
    mergeEdgeTls(RAW_BASE, { tags: { name: 'messaging_health' } }),
  );
  const ok = res.status === 200 || res.status === 429 || res.status === 503;
  errors.add(!ok);
  check(res, { ok: (r) => r.status === 200 || r.status === 429 || r.status === 503 });
  sleep(0.2);
}
