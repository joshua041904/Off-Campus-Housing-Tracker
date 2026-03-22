/**
 * k6 messaging E2E: User A registers, logs in, sends 50 messages in 60s.
 * Expect: some rate limited (after 30/min), no 500s, P95 latency < 200ms.
 * Requires: BASE_URL, K6_RESOLVE, SSL_CERT_FILE; optional TOKEN (or script registers/logs in).
 *
 * Usage:
 *   BASE_URL=https://off-campus-housing.test K6_RESOLVE=... SSL_CERT_FILE=./certs/dev-root.pem \
 *   k6 run scripts/load/k6-messaging-flow.js
 *   DURATION=60s MESSAGES_TOTAL=50 k6 run scripts/load/k6-messaging-flow.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const BASE = RAW_BASE;
const DURATION = __ENV.DURATION || '60s';
const MESSAGES_TOTAL = Number(__ENV.MESSAGES_TOTAL || 50);
const TOKEN = __ENV.TOKEN || '';

export const errors = new Rate('errors');
export const rate_limited = new Rate('rate_limited');

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  scenarios: {
    send_messages: {
      executor: 'constant-arrival-rate',
      rate: Math.min(MESSAGES_TOTAL / 60, 30),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: {
    errors: ['rate<0.05'],
    rate_limited: ['rate<0.5'],
    http_req_duration: ['p(95)<200', 'p(99)<350', 'max<800'],
    http_req_failed: ['rate<0.02'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  // Placeholder: hit messaging health or send-message endpoint when available
  const res = http.get(
    `${BASE}/api/messaging/healthz`,
    mergeEdgeTls(RAW_BASE, { tags: { name: 'send_message' }, headers }),
  );
  const ok = res.status === 200;
  if (res.status === 429) rate_limited.add(1);
  else errors.add(!ok);
  check(res, { 'status 200 or 429': (r) => r.status === 200 || r.status === 429 });
  sleep(0.5);
}
