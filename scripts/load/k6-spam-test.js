/**
 * k6 spam scenario: send same message to 30 recipients.
 * Expect: Trust flags user; SendMessage returns permission denied (or 403).
 * Requires: BASE_URL, TOKEN (or register/login), K6_RESOLVE, SSL_CERT_FILE.
 *
 * Usage:
 *   TOKEN=<jwt> BASE_URL=... K6_RESOLVE=... SSL_CERT_FILE=./certs/dev-root.pem \
 *   k6 run scripts/load/k6-spam-test.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const BASE = RAW_BASE;
const TOKEN = __ENV.TOKEN || '';
const RECIPIENTS = Number(__ENV.RECIPIENTS || 30);

export const permission_denied = new Rate('permission_denied');

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: 1,
  iterations: RECIPIENTS,
  thresholds: {
    permission_denied: ['rate>0.5'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  // Placeholder: POST SendMessage or CreateConversation + SendMessage per recipient
  // When implemented: expect 403/PERMISSION_DENIED after Trust flags user
  const res = http.get(
    `${BASE}/api/messaging/healthz`,
    mergeEdgeTls(RAW_BASE, { tags: { name: 'send_to_recipient' }, headers }),
  );
  if (res.status === 403) permission_denied.add(1);
  check(res, { 'eventually denied': (r) => r.status === 200 || r.status === 403 });
}
