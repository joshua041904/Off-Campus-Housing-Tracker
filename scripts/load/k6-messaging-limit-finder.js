/**
 * Limit finder: ramping-arrival-rate until P99 > 500ms or error rate > 5%.
 * Defines safe capacity envelope. Use after E2E flow works.
 *
 * Usage: BASE_URL=... K6_RESOLVE=... SSL_CERT_FILE=... k6 run scripts/load/k6-messaging-limit-finder.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'https://off-campus-housing.local').replace(/\/$/, '');
const SKIP_TLS = (__ENV.K6_INSECURE_SKIP_TLS || '0') === '1';

export const errors = new Rate('errors');

function parseHosts() {
  const r = __ENV.K6_RESOLVE || '';
  if (!r) return {};
  const parts = r.split(':');
  if (parts.length < 3) return {};
  return { [parts[0]]: parts[parts.length - 1] };
}

export const options = {
  ...parseHosts(),
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
    errors: ['rate<0.05'],
    http_req_duration: ['p(99)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const opts = { tags: { name: 'messaging_health' } };
  if (SKIP_TLS) opts.insecureSkipTLSVerify = true;
  const res = http.get(`${BASE}/api/messaging/healthz`, opts);
  errors.add(res.status >= 500);
  check(res, { 'ok': (r) => r.status === 200 || r.status === 429 });
  sleep(0.2);
}
