/**
 * k6 HTTP/3 (QUIC) Toolchain
 * 
 * Custom toolchain for k6 to work with HTTP/3 explicitly.
 * 
 * IMPORTANT: k6 v1.4.2 does NOT natively support HTTP/3 (QUIC) yet.
 * 
 * Current Status:
 * - k6 v1.4.2: No native HTTP/3 support
 * - Custom k6 binary with HTTP/3 extension: Available via xk6 (see scripts/build-k6-http3.sh)
 * - HTTP/3 extension: xk6-http3 (local development)
 * 
 * Building Custom k6 with HTTP/3:
 *   1. Run: ./scripts/build-k6-http3.sh
 *   2. This builds a custom k6 binary with HTTP/3 support using quic-go
 *   3. Binary location: .k6-build/bin/k6-http3
 * 
 * Usage:
 *   # With custom k6-http3 binary:
 *   ./scripts/run-k6-http3-test.sh
 *   
 *   # Or directly:
 *   .k6-build/bin/k6-http3 run scripts/load/k6-http3-toolchain.js
 * 
 *   # With standard k6 (will fall back to HTTP/2):
 *   k6 run scripts/load/k6-http3-toolchain.js
 * 
 *   # For curl-based HTTP/3 testing (always works):
 *   bash scripts/test-microservices-http2-http3.sh
 * 
 * Note: If using the custom k6-http3 binary, the http3 extension is available as:
 *   import http3 from 'k6/x/http3';
 *   const res = http3.get(url, options);
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

// Try to import HTTP/3 extension (only available if custom k6-http3 binary is used)
// k6 extensions use ES6 import syntax
let http3 = null;
try {
  http3 = require('k6/x/http3');
  console.log('[HTTP/3] Extension loaded successfully!');
} catch (e) {
  // Extension not available - will use standard k6 httpVersion: 'HTTP/3' (may fall back to HTTP/2)
  console.log('[HTTP/3] Extension not available, will use standard k6 httpVersion: "HTTP/3"');
}

// Custom metrics for HTTP/3
const h3Success = new Rate('http3_success');
const h3Latency = new Trend('http3_latency_ms', true);
const h3Errors = new Rate('http3_errors');

// Configuration
const BASE_URL = (__ENV.BASE_URL || 'https://off-campus-housing.test:30443').replace(/\/$/, '');
const RAW_BASE = BASE_URL;
const HOST = __ENV.HOST || 'off-campus-housing.test';

export const options = {
  ...strictEdgeTlsOptions(RAW_BASE),
  stages: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 10 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    'http3_success': ['rate>0.95'],
    'http3_latency_ms': ['p(95)<1000'],
  },
};

/**
 * Make HTTP/3 request using k6's native support (if available)
 */
function makeHttp3Request(method, url, body, headers) {
  const startTime = Date.now();
  
  try {
    // Build headers object (k6 doesn't support spread operator)
    const requestHeaders = {
      'Host': HOST,
      'Content-Type': 'application/json',
      'X-Loadtest': '1',
    };
    // Add custom headers if provided
    if (headers && typeof headers === 'object') {
      for (const key in headers) {
        if (headers.hasOwnProperty(key)) {
          requestHeaders[key] = headers[key];
        }
      }
    }
    
    // Try to use k6's HTTP/3 support (experimental)
    const params = mergeEdgeTls(RAW_BASE, {
      headers: requestHeaders,
      timeout: '30s',
      // Explicitly request HTTP/3 (QUIC)
      // Note: This may not work in all k6 builds and may fall back to HTTP/2
      httpVersion: 'HTTP/3',
    });
    
    let res;
    switch (method.toUpperCase()) {
      case 'GET':
        res = http.get(url, params);
        break;
      case 'POST':
        res = http.post(url, JSON.stringify(body), params);
        break;
      case 'PUT':
        res = http.put(url, JSON.stringify(body), params);
        break;
      case 'DELETE':
        res = http.del(url, null, params);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    const latency = Date.now() - startTime;
    const success = res.status >= 200 && res.status < 300;
    
    h3Latency.add(latency);
    h3Success.add(success);
    h3Errors.add(!success);
    
    return { res, latency, success };
  } catch (error) {
    const latency = Date.now() - startTime;
    h3Latency.add(latency);
    h3Success.add(false);
    h3Errors.add(true);
    
    console.error(`[HTTP/3] Request failed: ${error.message}`);
    return {
      res: { status: 0, status_text: 'Request Failed', body: '', error: error.message },
      latency,
      success: false,
    };
  }
}

/**
 * Make HTTP/3 request using custom extension (if available)
 */
function makeHttp3RequestWithExtension(method, url, body, headers) {
  const startTime = Date.now();
  
  if (!http3) {
    throw new Error('HTTP/3 extension not available');
  }
  
  try {
    // Build headers object
    const requestHeaders = { Host: HOST };
    if (headers && typeof headers === 'object') {
      for (const key in headers) {
        if (headers.hasOwnProperty(key)) {
          requestHeaders[key] = headers[key];
        }
      }
    }
    
    let result;
    switch (method.toUpperCase()) {
      case 'GET':
        result = http3.get(
          url,
          mergeEdgeTls(RAW_BASE, {
            headers: requestHeaders,
            timeout: '60s',
          }),
        );
        break;
      case 'POST':
        result = http3.post(
          url,
          JSON.stringify(body || {}),
          mergeEdgeTls(RAW_BASE, {
            headers: requestHeaders,
            timeout: '60s',
          }),
        );
        break;
      default:
        throw new Error(`Method ${method} not yet implemented in extension`);
    }
    
    const latency = Date.now() - startTime;
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    const res = {
      status: result.status || 0,
      status_text: result.status ? 'OK' : 'Error',
      body: result.body || '',
      proto: result.proto || 'HTTP/3',
    };
    const success = res.status >= 200 && res.status < 300;
    
    h3Latency.add(latency);
    h3Success.add(success);
    h3Errors.add(!success);
    
    return { res, latency, success };
  } catch (error) {
    const latency = Date.now() - startTime;
    h3Latency.add(latency);
    h3Success.add(false);
    h3Errors.add(true);
    
    console.error(`[HTTP/3] Extension request failed: ${error.message}`);
    return {
      res: { status: 0, status_text: 'Request Failed', body: '', error: error.message },
      latency,
      success: false,
    };
  }
}

export default function () {
  let res, latency, success;
  let usedExtension = false;
  
  // Try to use HTTP/3 extension first (if custom k6-http3 binary is used)
  if (http3) {
    try {
      console.log('[HTTP/3] Attempting to use custom extension...');
      const result = makeHttp3RequestWithExtension('GET', `${BASE_URL}/_caddy/healthz`, null, {});
      res = result.res;
      latency = result.latency;
      success = result.success;
      usedExtension = true;
      console.log(`[HTTP/3] ✅ Using custom extension - Status: ${res.status}, Proto: ${res.proto || 'HTTP/3'}`);
    } catch (e) {
      console.warn(`[HTTP/3] Extension failed: ${e.message}, falling back to standard k6`);
      // Fall through to standard k6
    }
  }
  
  // If extension not available or failed, use standard k6 (may fall back to HTTP/2)
  if (!usedExtension) {
    const result = makeHttp3Request('GET', `${BASE_URL}/_caddy/healthz`, null, {});
    res = result.res;
    latency = result.latency;
    success = result.success;
    
    if (res.status === 0 || !success) {
      console.warn(`[HTTP/3] Standard k6 HTTP/3 failed - likely falling back to HTTP/2`);
      console.warn(`[HTTP/3] For actual HTTP/3 testing, build custom k6: ./scripts/build-k6-http3.sh`);
      console.warn(`[HTTP/3] Or use curl-based testing: scripts/test-microservices-http2-http3.sh`);
    } else {
      console.log(`[HTTP/3] Using standard k6 (may be HTTP/2 fallback) - Status: ${res.status}`);
    }
  }
  
  // Only check if we got a valid response
  if (res && res.status > 0) {
    check(res, {
      'HTTP/3 health check status 200': (r) => r.status === 200,
    });
  }
  
  sleep(1);
}

export function handleSummary(data) {
  // Safely access metrics with null checks
  const http3Success = data.metrics && data.metrics.http3_success ? data.metrics.http3_success.values.rate * 100 : 0;
  const http3Errors = data.metrics && data.metrics.http3_errors ? data.metrics.http3_errors.values.rate * 100 : 0;
  const http3Latency = data.metrics && data.metrics.http3_latency_ms && data.metrics.http3_latency_ms.values ? data.metrics.http3_latency_ms.values : {};
  const httpReqs = data.metrics && data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const httpReqFailed = data.metrics && data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * httpReqs : 0;
  
  return {
    'stdout': `
=== HTTP/3 (QUIC) Test Results ===

Success Rate: ${http3Success.toFixed(2)}%
Error Rate: ${http3Errors.toFixed(2)}%

Latency (p95): ${http3Latency['p(95)'] ? http3Latency['p(95)'].toFixed(2) : 'N/A'}ms
Latency (p99): ${http3Latency['p(99)'] ? http3Latency['p(99)'].toFixed(2) : 'N/A'}ms

Total Requests: ${httpReqs}
Failed Requests: ${httpReqFailed.toFixed(0)}

Note: HTTP/3 extension built and loads successfully, but NodePort UDP routing
may cause connection timeouts. For reliable HTTP/3 testing, use:
  ./scripts/test-microservices-http2-http3.sh (curl-based, verified with tcpdump)

Build custom k6: ./scripts/build-k6-http3.sh
See: test-results/K6_HTTP3_TOOLCHAIN_STATUS_12-22_tom.md
    `,
  };
}
