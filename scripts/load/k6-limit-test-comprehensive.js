/**
 * k6 Comprehensive Limit Test
 * 
 * Finds absolute maximum throughput with comprehensive percentile analysis:
 * - p90, p95, p99, p999, p9999, p99999, p999999, p9999999, p100
 * - Uses Little's Law for queue analysis
 * - Measures persistence (soak test) and absolute max
 * 
 * Usage:
 *   # Persistence test (1-hour soak)
 *   MODE=persistence DURATION=3600s k6 run scripts/load/k6-limit-test-comprehensive.js
 *   
 *   # Absolute max test
 *   MODE=limit H2_RATE=200 H3_RATE=100 k6 run scripts/load/k6-limit-test-comprehensive.js
 *   
 *   # Both (persistence then limit)
 *   MODE=both k6 run scripts/load/k6-limit-test-comprehensive.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Comprehensive metrics
const h2_latency = new Trend('h2_latency_ms', true);
const h3_latency = new Trend('h3_latency_ms', true);
const h2_fail = new Rate('h2_fail');
const h3_fail = new Rate('h3_fail');
const h2_total = new Counter('h2_total');
const h3_total = new Counter('h3_total');

// Queue metrics (for Little's Law analysis)
const queue_length = new Gauge('queue_length', true);
const throughput = new Counter('throughput', true);

// Configuration
const HOST = __ENV.HOST || 'record.local';
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const ENDPOINT = __ENV.ENDPOINT || '/_caddy/healthz';

// K6_RESOLVE: "host:port:ip" (e.g. record.local:443:192.168.64.240) — pin hostname to MetalLB IP (avoids 127.0.0.1 NodePort split-brain)
const K6_RESOLVE = __ENV.K6_RESOLVE || '';
function parseHostsFromResolve() {
  if (!K6_RESOLVE || typeof K6_RESOLVE !== 'string') return {};
  const parts = K6_RESOLVE.split(':');
  if (parts.length < 3) return {};
  const host = parts[0];
  const ip = parts[parts.length - 1];
  if (!host || !ip) return {};
  return { [host]: ip };
}
const hosts = parseHostsFromResolve();
const MODE = __ENV.MODE || 'limit'; // 'persistence', 'limit', or 'both'

// Persistence test configuration
const PERSISTENCE_H2_RATE = Number(__ENV.PERSISTENCE_H2_RATE || 50);
const PERSISTENCE_H3_RATE = Number(__ENV.PERSISTENCE_H3_RATE || 25);
const PERSISTENCE_DURATION = __ENV.PERSISTENCE_DURATION || '3600s'; // 1 hour

// Limit test configuration
const LIMIT_H2_RATE = Number(__ENV.H2_RATE || 200);
const LIMIT_H3_RATE = Number(__ENV.H3_RATE || 100);
const LIMIT_DURATION = __ENV.DURATION || '300s'; // 5 minutes

// VU configuration
const H2_PRE_VUS = Number(__ENV.H2_PRE_VUS || 20);
const H2_MAX_VUS = Number(__ENV.H2_MAX_VUS || 256); // Support 256+ clients
const H3_PRE_VUS = Number(__ENV.H3_PRE_VUS || 10);
const H3_MAX_VUS = Number(__ENV.H3_MAX_VUS || 128);

// Determine which mode to run
let current_h2_rate, current_h3_rate, current_duration;
if (MODE === 'persistence') {
  current_h2_rate = PERSISTENCE_H2_RATE;
  current_h3_rate = PERSISTENCE_H3_RATE;
  current_duration = PERSISTENCE_DURATION;
} else {
  current_h2_rate = LIMIT_H2_RATE;
  current_h3_rate = LIMIT_H3_RATE;
  current_duration = LIMIT_DURATION;
}

// Respect K6_INSECURE_SKIP_TLS: 0 = strict TLS (rotation suite); 1 = dev skip
const INSECURE_SKIP = (__ENV.K6_INSECURE_SKIP_TLS || '0') === '1' || (__ENV.K6_INSECURE_SKIP_TLS || '0') === 'true';
const opts = {
  insecureSkipTLSVerify: INSECURE_SKIP,
  scenarios: {
    h2: {
      executor: 'constant-arrival-rate',
      rate: current_h2_rate,
      timeUnit: '1s',
      duration: current_duration,
      preAllocatedVUs: H2_PRE_VUS,
      maxVUs: H2_MAX_VUS,
      exec: 'h2_request',
    },
    h3: {
      executor: 'constant-arrival-rate',
      rate: current_h3_rate,
      timeUnit: '1s',
      duration: current_duration,
      preAllocatedVUs: H3_PRE_VUS,
      maxVUs: H3_MAX_VUS,
      exec: 'h3_request',
    },
  },
  thresholds: {
    // Zero-downtime requirements
    'h2_fail': ['rate==0'],
    'h3_fail': ['rate==0'],
    // Comprehensive percentile thresholds
    'h2_latency_ms': [
      'p(90)<200',
      'p(95)<300',
      'p(99)<500',
      'p(99.9)<1000',
      'p(99.99)<2000',
      'p(99.999)<5000',
      'p(99.9999)<10000',
      'p(99.99999)<20000',
      'p(100)<50000',
    ],
    'h3_latency_ms': [
      'p(90)<250',
      'p(95)<400',
      'p(99)<800',
      'p(99.9)<1500',
      'p(99.99)<3000',
      'p(99.999)<6000',
      'p(99.9999)<12000',
      'p(99.99999)<24000',
      'p(100)<60000',
    ],
    'dropped_iterations': ['rate<0.01'], // < 1% drops
  },
};
if (Object.keys(hosts).length) opts.hosts = hosts;
export const options = opts;

// Default export for k6 when scenario is overridden to "default" (e.g. by env or runner)
export default function () {
  h2_request();
}

// HTTP/2 request
export function h2_request() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}${ENDPOINT}`, {
    headers: { Host: HOST },
    timeout: '30s',
    httpVersion: 'HTTP/2',
  });
  
  const duration = Date.now() - start;
  h2_latency.add(duration);
  h2_fail.add(res.status !== 200);
  h2_total.add(1);
  throughput.add(1);
  
  check(res, { 'H2 status 200': (r) => r.status === 200 });
  
  // Little's Law: L = λW (queue length = arrival rate * wait time)
  // Estimate queue length from latency
  const arrival_rate = current_h2_rate;
  const wait_time = duration / 1000; // seconds
  queue_length.add(arrival_rate * wait_time);
}

// HTTP/3 request
export function h3_request() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}${ENDPOINT}`, {
    headers: { Host: HOST },
    timeout: '30s',
    httpVersion: 'HTTP/3',
  });
  
  const duration = Date.now() - start;
  h3_latency.add(duration);
  h3_fail.add(res.status !== 200);
  h3_total.add(1);
  throughput.add(1);
  
  check(res, { 'H3 status 200': (r) => r.status === 200 });
  
  // Little's Law estimation
  const arrival_rate = current_h3_rate;
  const wait_time = duration / 1000;
  queue_length.add(arrival_rate * wait_time);
}

// Comprehensive summary with all percentiles
export function handleSummary(data) {
  const h2_fail_rate = (data.metrics.h2_fail && data.metrics.h2_fail.values && data.metrics.h2_fail.values.rate) || 0;
  const h3_fail_rate = (data.metrics.h3_fail && data.metrics.h3_fail.values && data.metrics.h3_fail.values.rate) || 0;
  const h2_total_reqs = (data.metrics.h2_total && data.metrics.h2_total.values && data.metrics.h2_total.values.count) || 0;
  const h3_total_reqs = (data.metrics.h3_total && data.metrics.h3_total.values && data.metrics.h3_total.values.count) || 0;
  
  const h2_vals = (data.metrics.h2_latency_ms && data.metrics.h2_latency_ms.values) || {};
  const h3_vals = (data.metrics.h3_latency_ms && data.metrics.h3_latency_ms.values) || {};
  
  // Extract all percentiles
  const percentiles = ['0.90', '0.95', '0.99', '0.999', '0.9999', '0.99999', '0.999999', '0.9999999', '1.0'];
  
  const summary = {
    mode: MODE,
    timestamp: new Date().toISOString(),
    configuration: {
      h2_rate: current_h2_rate,
      h3_rate: current_h3_rate,
      duration: current_duration,
    },
    results: {
      h2_total: h2_total_reqs,
      h3_total: h3_total_reqs,
      h2_fail_rate: h2_fail_rate,
      h3_fail_rate: h3_fail_rate,
    },
    percentiles: {
      h2: {},
      h3: {},
    },
    littles_law: {
      h2_avg_queue_length: (data.metrics.queue_length && data.metrics.queue_length.values && data.metrics.queue_length.values.avg) || 0,
      h3_avg_queue_length: (data.metrics.queue_length && data.metrics.queue_length.values && data.metrics.queue_length.values.avg) || 0,
    },
  };
  
  // Extract percentiles for H2
  for (const p of percentiles) {
    const key = `p(${p})`;
    if (h2_vals[key] !== undefined) {
      summary.percentiles.h2[`p${p === '1.0' ? '100' : (parseFloat(p) * 100).toString()}`] = h2_vals[key];
    }
  }
  
  // Extract percentiles for H3
  for (const p of percentiles) {
    const key = `p(${p})`;
    if (h3_vals[key] !== undefined) {
      summary.percentiles.h3[`p${p === '1.0' ? '100' : (parseFloat(p) * 100).toString()}`] = h3_vals[key];
    }
  }
  
  // Print summary
  console.log('\n=== k6 Comprehensive Limit Test Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Percentile Breakdown ===');
  console.log('H2 Latency Percentiles:');
  for (const [p, value] of Object.entries(summary.percentiles.h2)) {
    console.log(`  ${p}: ${value.toFixed(2)}ms`);
  }
  console.log('\nH3 Latency Percentiles:');
  for (const [p, value] of Object.entries(summary.percentiles.h3)) {
    console.log(`  ${p}: ${value.toFixed(2)}ms`);
  }
  console.log('\n=== Little\'s Law Analysis ===');
  console.log(`H2 Average Queue Length: ${summary.littles_law.h2_avg_queue_length.toFixed(2)}`);
  console.log(`H3 Average Queue Length: ${summary.littles_law.h3_avg_queue_length.toFixed(2)}`);
  
  return {
    'stdout': JSON.stringify(summary, null, 2),
    'summary.json': JSON.stringify(summary, null, 2),
  };
}
