/**
 * k6: POST direct message through edge (/api/messaging/messages) with JWT.
 * Protocol: HTTPS to BASE_URL (same stack as Playwright edge tests).
 *
 * Env:
 *   BASE_URL          — https://off-campus-housing.test (default)
 *   TOKEN             — Bearer JWT for sender (required)
 *   RECIPIENT_ID      — UUID string for recipient (required)
 *   SSL_CERT_FILE     — trust dev CA (e.g. ./certs/dev-root.pem)
 *   K6_RESOLVE        — optional Host → IP map if DNS missing in runner
 *   VUS, DURATION     — optional load knobs (defaults: smoke)
 *
 * Example:
 *   TOKEN=... RECIPIENT_ID=... SSL_CERT_FILE=./certs/dev-root.pem \
 *     k6 run scripts/load/k6-messaging-direct-message.js
 *
 * After run (local Postgres on 5444):
 *   VERIFY_DB=1 ./scripts/verify-after-k6-messaging-db.sh
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const TOKEN = __ENV.TOKEN || '';
const RECIPIENT = __ENV.RECIPIENT_ID || '';

export const errors = new Rate('messaging_post_errors');

const vus = Number(__ENV.VUS || 3);
const duration = __ENV.DURATION || '30s';

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  scenarios: {
    direct_messages: {
      executor: 'constant-vus',
      vus: Math.max(1, vus),
      duration,
    },
  },
  thresholds: {
    messaging_post_errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
});

export default function () {
  if (!TOKEN || !RECIPIENT) {
    errors.add(1);
    return;
  }
  const body = JSON.stringify({
    recipient_id: RECIPIENT,
    message_type: 'direct',
    subject: 'k6-direct',
    content: `k6 ${__VU}-${__ITER}-${Date.now()}`,
  });
  const res = http.post(
    `${RAW_BASE}/api/messaging/messages`,
    body,
    mergeEdgeTls(RAW_BASE, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        'x-loadtest': '1',
      },
      tags: { name: 'messaging_direct' },
    }),
  );
  const ok = res.status === 201 || res.status === 429;
  errors.add(!ok);
  check(res, {
    '201 created or 429 rate limit': (r) => r.status === 201 || r.status === 429,
  });
  sleep(0.3);
}
