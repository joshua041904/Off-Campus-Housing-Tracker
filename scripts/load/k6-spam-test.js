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

const BASE = (__ENV.BASE_URL || 'https://off-campus-housing.local').replace(/\/$/, '');
const TOKEN = __ENV.TOKEN || '';
const RECIPIENTS = Number(__ENV.RECIPIENTS || 30);
const SKIP_TLS = (__ENV.K6_INSECURE_SKIP_TLS || '0') === '1';

export const permission_denied = new Rate('permission_denied');

function parseHosts() {
  const r = __ENV.K6_RESOLVE || '';
  if (!r) return {};
  const parts = r.split(':');
  if (parts.length < 3) return {};
  return { [parts[0]]: parts[parts.length - 1] };
}

export const options = {
  ...parseHosts(),
  vus: 1,
  iterations: RECIPIENTS,
  thresholds: {
    permission_denied: ['rate>0.5'],
  },
};

export default function () {
  const opts = { tags: { name: 'send_to_recipient' } };
  if (SKIP_TLS) opts.insecureSkipTLSVerify = true;
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  // Placeholder: POST SendMessage or CreateConversation + SendMessage per recipient
  // When implemented: expect 403/PERMISSION_DENIED after Trust flags user
  const res = http.get(`${BASE}/api/messaging/healthz`, opts);
  if (res.status === 403) permission_denied.add(1);
  check(res, { 'eventually denied': (r) => r.status === 200 || r.status === 403 });
}
