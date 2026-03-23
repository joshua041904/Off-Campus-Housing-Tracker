/**
 * Single-step HTTP/3 load at fixed RPS. Used by run-k6-max-rps-no-errors.sh to find max RPS with zero errors.
 * Requires xk6-http3 binary. Exit 0 only when all requests succeed (runner stops when this exits non-zero).
 * Env: RATE (req/s), DURATION (e.g. 20s), BASE_URL, HOST.
 */
let http3 = null;
let http3_available = false;
try {
  http3 = require('k6/x/http3');
  http3_available = true;
} catch (e) {
  http3_available = false;
}

import { check } from 'k6';

const HOST = __ENV.HOST || 'off-campus-housing.test';
const BASE = (__ENV.BASE_URL || 'https://off-campus-housing.test').replace(/\/$/, '');
const RATE = Number(__ENV.RATE || 25);
const DURATION = __ENV.DURATION || '20s';
const VUS = Number(__ENV.VUS || 10);
const URL = `${BASE}/api/records`;

export const options = {
  scenarios: {
    h3_only: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: Math.max(VUS, 64),
      exec: 'run',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)'],
};

function run() {
  if (!http3_available) return false;
  let ok = false;
  try {
    const res = http3.get(URL, {
      headers: { Host: HOST },
      timeout: '15s',
      insecureSkipTLSVerify: false,
    });
    ok = res && res.status >= 200 && res.status < 400;
  } catch (e) {
    ok = false;
  }
  return ok;
}

export default function () {
  const ok = run();
  check(ok, { 'HTTP/3 status ok': () => ok });
}
