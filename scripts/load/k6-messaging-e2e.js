/**
 * Full E2E: Register → Login → Create conversation → Send message → Get conversation.
 * Tests JWT, gateway, gRPC, DB, outbox, Kafka. No healthz placeholder.
 *
 * Usage:
 *   BASE_URL=https://off-campus-housing.test K6_RESOLVE=host:443:ip SSL_CERT_FILE=./certs/dev-root.pem \
 *   k6 run scripts/load/k6-messaging-e2e.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

const RAW_BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const BASE = RAW_BASE;

export const errors = new Rate('errors');

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  vus: 5,
  iterations: 20,
  thresholds: {
    errors: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<200', 'p(99)<350', 'max<800'],
  },
};

function request(method, url, body = null, token = null) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: url.split('?')[0] },
  };
  if (token) params.headers['Authorization'] = `Bearer ${token}`;
  return http.request(method, `${BASE}${url}`, body ? JSON.stringify(body) : null, mergeEdgeTls(RAW_BASE, params));
}

export default function () {
  const emailA = `userA_${__VU}_${__ITER}@test.com`;
  const password = 'Password123!';

  let res = request('POST', '/api/auth/register', { email: emailA, password });
  check(res, { 'register A ok': (r) => r.status === 201 || r.status === 200 });
  errors.add(res.status >= 500);

  res = request('POST', '/api/auth/login', { email: emailA, password });
  check(res, { 'login A ok': (r) => r.status === 200 });
  errors.add(res.status >= 500);
  const tokenA = res.json('token') || res.json('accessToken') || '';

  res = request('POST', '/api/messaging/create-conversation', { participant_id: 'landlord-demo-id' }, tokenA);
  check(res, { 'create conversation ok': (r) => r.status === 201 || r.status === 200 });
  errors.add(res.status >= 500);
  const conversationId = res.json('conversation_id') || res.json('id') || '';

  res = request('POST', '/api/messaging/send', { conversation_id: conversationId, content: 'hello from k6' }, tokenA);
  check(res, { 'send message ok': (r) => r.status === 201 || r.status === 200 });
  errors.add(res.status >= 500);

  res = request('GET', `/api/messaging/conversation/${conversationId}`, null, tokenA);
  check(res, { 'get conversation ok': (r) => r.status === 200 });
  errors.add(res.status >= 500);

  sleep(0.5);
}
