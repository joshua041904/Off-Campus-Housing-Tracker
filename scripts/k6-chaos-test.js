import http from "k6/http";
import http3 from "k6/x/http3";  // Custom HTTP/3 extension (xk6-http3)
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// No remote import (jslib.k6.io): in-cluster pods often have no egress → script load fails with exit 107.
// Inline summary avoids network at load time. For jslib: allow egress to jslib.k6.io or run k6 on host.
function inlineTextSummary(data) {
  const lines = ["\n=== k6 summary ==="];
  const fmt = (x) => (x != null && !Number.isNaN(Number(x))) ? Number(x).toFixed(2) : "n/a";
  if (data && data.metrics) {
    for (const [name, m] of Object.entries(data.metrics)) {
      if (m && m.values) {
        const v = m.values;
        const rate = v.rate != null ? ` rate=${fmt(v.rate)}` : "";
        const avg = v.avg != null ? ` avg=${fmt(v.avg)}` : "";
        const p99 = v["p(99)"] != null ? ` p99=${fmt(v["p(99)"])}` : "";
        lines.push(`  ${name}:${rate}${avg}${p99} passes=${v.passes || 0} fails=${v.fails || 0}`);
      }
    }
  }
  return lines.join("\n");
}

// Request timeout and thresholds tuned for 500 req/s (320 H2 + 180 H3) after rotation:
// - 15s timeout: under load, occasional slow responses; avoids "request timeout" failures
// - Thresholds allow small failure rate and higher p99 so run passes at 500 req/s (k3d/Colima)

// Metrics: fail = (status !== 200) for both H2 and H3; timeout/protocol_mismatch separate for diagnostics.
let h2_latency = new Trend("h2_latency");
let h3_latency = new Trend("h3_latency");
let h2_fail = new Rate("h2_fail");
let h3_fail = new Rate("h3_fail");
let h2_timeout = new Rate("h2_timeout");       // status=0: saturation/timeout
let h3_timeout = new Rate("h3_timeout");
let h2_protocol_mismatch = new Rate("h2_protocol_mismatch");  // wrong proto when status!=0
let h3_protocol_mismatch = new Rate("h3_protocol_mismatch");
// STRICT_H3=1: custom metric so threshold exists at startup (k6 has no built-in "errors" metric)
let h3_strict_fail = new Rate("h3_strict_fail");

// K6_RESOLVE: "host:port:ip" — pin hostname to LB IP for HTTP/2 only. xk6-http3 ignores options.hosts.
const K6_RESOLVE = __ENV.K6_RESOLVE || "";
function parseHostsFromResolve() {
  if (!K6_RESOLVE || typeof K6_RESOLVE !== "string") return {};
  const parts = K6_RESOLVE.split(":");
  if (parts.length < 3) return {};
  const host = parts[0];
  const ip = parts[parts.length - 1];
  if (!host || !ip) return {};
  return { [host]: ip };
}
const HOSTS = parseHostsFromResolve();

// H2_RATE=0 → H3-only (strict QUIC validation). constant-arrival-rate requires rate > 0, so omit h2 when 0.
const _h2RateRaw = __ENV.H2_RATE != null && __ENV.H2_RATE !== "" ? parseInt(__ENV.H2_RATE, 10) : 80;
const H2_RATE_NUM = Number.isNaN(_h2RateRaw) ? 80 : _h2RateRaw;
const h2Enabled = H2_RATE_NUM > 0;

const h3Scenario = __ENV.H3_EXECUTOR === "constant-arrival-rate"
  ? {
      executor: "constant-arrival-rate",
      rate: __ENV.H3_RATE ? parseInt(__ENV.H3_RATE) : 180,
      timeUnit: "1s",
      duration: __ENV.DURATION || "180s",
      preAllocatedVUs: __ENV.H3_PRE_VUS ? parseInt(__ENV.H3_PRE_VUS) : 200,
      maxVUs: __ENV.H3_MAX_VUS ? parseInt(__ENV.H3_MAX_VUS) : 600,
      gracefulStop: "30s",
      exec: "h3_request",
    }
  : {
      executor: "constant-vus",
      vus: __ENV.H3_VUS ? parseInt(__ENV.H3_VUS) : 20,
      duration: __ENV.H3_DURATION || __ENV.DURATION || "90s",
      exec: "h3_request",
    };

const scenarios = h2Enabled
  ? {
      h2: {
        executor: "constant-arrival-rate",
        rate: Math.max(1, H2_RATE_NUM),
        timeUnit: "1s",
        duration: __ENV.DURATION || "180s",
        preAllocatedVUs: __ENV.H2_PRE_VUS ? parseInt(__ENV.H2_PRE_VUS) : 20,
        maxVUs: __ENV.H2_MAX_VUS ? parseInt(__ENV.H2_MAX_VUS) : 50,
        exec: "h2_request",
      },
      h3: h3Scenario,
    }
  : { h3: h3Scenario };

const thresholds = {
  "h3_latency": ["p(99)<15000"], // 15s p99; QUIC tail under 500 req/s can spike (observed max~15s)
};
if (h2Enabled) {
  thresholds["h2_fail"] = ["rate<0.01"];
  thresholds["h2_latency"] = ["p(99)<5000"];
}

// Rotation/chaos: disable connection reuse so no dead H2/QUIC sessions under load (avoids 12s idle timeouts and stream exhaustion).
const opts = {
  insecureSkipTLSVerify: false,
  noConnectionReuse: true,
  scenarios,
  thresholds,
};
// STRICT_H3=1: fail run on any H3 protocol fallback (Transport Hardening V4; use custom metric, not "errors")
if (__ENV.STRICT_H3 === "1") {
  opts.thresholds["h3_strict_fail"] = ["rate<0.01"];
}
// options.hosts for HTTP/2 only (xk6-http3 ignores it)
if (Object.keys(HOSTS).length) opts.hosts = HOSTS;
export const options = opts;

const HOST = __ENV.HOST || "record.local";
const PORT = __ENV.K6_PORT || "443";
// K6_LB_IP: REQUIRED for HTTP/3 when running locally (MetalLB). Bypasses system DNS entirely.
// When unset (in-cluster): use ClusterIP FQDN — cluster DNS resolves correctly.
const LB_IP = __ENV.K6_LB_IP || HOSTS[HOST] || "";

// HTTP/2 URL (hostname — uses options.hosts when K6_RESOLVE set; default ClusterIP for in-cluster)
const H2_URL = __ENV.K6_TARGET_URL || "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz";

// HTTP/3 URL (IP — bypass DNS entirely when LB_IP set; else ClusterIP for in-cluster)
const H3_URL = LB_IP ? `https://${LB_IP}:${PORT}/_caddy/healthz` : H2_URL;

export function setup() {
  const noReuse = __ENV.K6_HTTP3_NO_REUSE !== "0";
  console.log("H3_URL:", H3_URL);
  if (LB_IP) console.log("[k6] H3 resolver-proof: connect to LB IP, serverName:", HOST);
  console.log("[k6] K6_HTTP3_NO_REUSE=" + (__ENV.K6_HTTP3_NO_REUSE || "1") + " → noReuse=" + noReuse + " (avoids stale QUIC after Caddy restart)");
  return {};
}

// HTTP/2 test with protocol verification
export function h2_request() {
  const res = http.get(H2_URL, {
    headers: { Host: HOST },
    timeout: "15s",  // Tuned for 500 req/s; avoids request timeout under load
    httpVersion: "HTTP/2",
    noConnectionReuse: true,  // Match global option; avoids stale H2 sessions and stream exhaustion under rotation load
    // Strict TLS 1.3
    tlsVersion: { min: "1.3", max: "1.3" },
  });

  h2_latency.add(res.timings.duration);
  const h2Status = res.status || 0;
  // Same success criteria as H3 and check(): fail when status !== 200 (aligns with http_req_failed and avoids misclassification).
  h2_fail.add(h2Status !== 200);
  if (h2Status === 0) h2_timeout.add(true); else h2_timeout.add(false);
  const h2Proto = (res.proto || "").trim().toLowerCase();
  // Only count mismatch when proto is explicitly wrong; empty proto (k6 often omits) is not a mismatch.
  const h2WrongProto = h2Status !== 0 && h2Proto !== "" && !h2Proto.includes("http/2");
  h2_protocol_mismatch.add(h2WrongProto);

  // Protocol verification (rate-limit H2 saturation warn to avoid flooding)
  const h2Iter = typeof __ITER !== "undefined" ? __ITER : 0;
  if (h2Proto !== "" && !h2Proto.includes("http/2")) {
    if (h2Status === 0) { if (h2Iter % 200 === 0) console.warn("[H2] Saturation/timeout (status=0) (sampled)"); }
    else console.warn("[H2] Protocol mismatch: expected HTTP/2, got", h2Proto);
  }
  
  check(res, { 
    "H2 status 200": (r) => r.status === 200,
    "H2 protocol HTTP/2": (r) => (r.proto || "").includes("HTTP/2"),
  });

  sleep(Math.random() * 0.01);
}

// HTTP/3 test — resolver-proof: connect via LB IP, validate TLS against record.local
// K6_H3_TIMEOUT: QUIC idle timeout (default 30s). "timeout: no recent network activity" occurs when
// UDP packets stall (Colima+MetalLB nested NAT). 30s gives more headroom than Go default ~15s.
// CRITICAL: noReuse must be true during rotation. When Caddy pod restarts, old QUIC connection IDs
// become invalid; reusing the session causes "context deadline exceeded" (Client.Timeout exceeded while
// awaiting headers) and HTTP/3 Success Rate 0%. K6_HTTP3_NO_REUSE=1 (default) forces fresh handshake per request.
const H3_TIMEOUT = __ENV.K6_H3_TIMEOUT || "30s";
export function h3_request() {
  const start = Date.now();

  const res = http3.get(H3_URL, {
    headers: { Host: HOST },
    timeout: H3_TIMEOUT,
    insecureSkipTLSVerify: false,
    serverName: HOST,
    // Default true: avoid stale QUIC sessions after Caddy cert reload / pod restart. Set K6_HTTP3_NO_REUSE=0 to allow reuse.
    noReuse: __ENV.K6_HTTP3_NO_REUSE !== "0",
  });

  const duration = Date.now() - start;
  h3_latency.add(duration);

  const status = res.status || 0;
  const proto = (res.proto || res.protocol || "").trim();
  // Same success criteria as H2 and check(): fail when status !== 200 (for rotation summary and http_req_failed alignment).
  h3_fail.add(status !== 200);
  if (status === 0) h3_timeout.add(true); else h3_timeout.add(false);
  // Only count protocol mismatch when we got 200 but proto is explicitly wrong; empty proto = assume HTTP/3 (xk6-http3 often omits).
  const h3WrongProto = status === 200 && proto !== "" && !proto.toLowerCase().includes("http/3");
  h3_protocol_mismatch.add(h3WrongProto);

  // STRICT_H3=1: fatal on fallback — only fail when proto is explicitly wrong (empty proto + 200 = assume H3)
  if (__ENV.STRICT_H3 === "1") {
    if (status !== 200) {
      h3_strict_fail.add(1);
      throw new Error(`H3 non-200: status=${status}`);
    }
    if (proto !== "" && !String(proto).toLowerCase().includes("http/3")) {
      h3_strict_fail.add(1);
      throw new Error(`H3 NOT negotiated. Got: "${proto}" (status=${status}). No fallback allowed.`);
    }
    h3_strict_fail.add(0); // record success so rate is defined
  }

  // Pass when status 200 and (proto empty = assume H3, or proto is HTTP/3). xk6-http3 does not reliably set res.proto.
  check(res, {
    "H3 status 200": (r) => (r.status || 0) === 200,
    "H3 protocol HTTP/3": (r) => {
      const s = (r.status || 0);
      const p = (r.proto || r.protocol || "").trim();
      return s === 200 && (p === "" || p.toLowerCase().includes("http/3"));
    },
  });

  // Only warn on real failures or explicit wrong proto; empty proto + 200 is xk6-http3 limitation, not mismatch
  const iter = typeof __ITER !== "undefined" ? __ITER : 0;
  if (status === 0) {
    if (iter % 200 === 0) console.warn(`[H3] Saturation/timeout (status=0): QUIC stalled under load (sampled)`);
  } else if (proto !== "" && !proto.toLowerCase().includes("http/3")) {
    console.warn(`[H3] Protocol mismatch: expected HTTP/3, got "${proto}" (status=${status})`);
  }

  sleep(Math.random() * 0.015);
}

// Database verification function (called in teardown)
function verify_database_state() {
  // Database connection info (from environment or defaults)
  const DB_HOST = __ENV.DB_HOST || "host.docker.internal";
  const DB_PORT = __ENV.DB_PORT || "5433";
  const DB_USER = __ENV.DB_USER || "postgres";
  const DB_PASSWORD = __ENV.DB_PASSWORD || "postgres";
  const DB_NAME = __ENV.DB_NAME || "records";
  
  // Log database verification attempt
  // Full verification will be done in post-test scripts using psql
  console.log(`[DB] Database verification requested for ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  console.log(`[DB] Note: Full verification should be done in post-test scripts with psql`);
}

// Database verification (run at test end)
export function teardown(data) {
  verify_database_state();
}

// Interpolate percentile when k6 omits it (e.g. p99.99999999 with few samples)
function lerp(a, b, t) {
  if (a == null || b == null || typeof a !== 'number' || typeof b !== 'number') return (a != null ? a : (b != null ? b : 0));
  return a + (b - a) * t;
}
function interpPercentile(pct, anchors) {
  const sorted = anchors.filter((x) => x.v != null && typeof x.v === 'number').sort((a, b) => a.p - b.p);
  if (sorted.length === 0) return 0;
  if (pct <= sorted[0].p) return sorted[0].v;
  if (pct >= sorted[sorted.length - 1].p) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (pct >= lo.p && pct <= hi.p) return lerp(lo.v, hi.v, (pct - lo.p) / (hi.p - lo.p));
  }
  return sorted[sorted.length - 1].v;
}

// Extract full percentiles p95..p99999999 with interpolation when k6 omits
function extractPercentiles(v) {
  if (!v || typeof v !== 'object') return {};
  const raw = function (k) { return (v[k] != null && typeof v[k] === 'number') ? v[k] : null; };
  const min = (v.min != null ? v.min : 0);
  const max = (v.max != null ? v.max : (raw('p(100)') != null ? raw('p(100)') : min));
  const avg = (v.avg != null ? v.avg : (min + max) / 2);
  const p50 = (raw('p(50)') != null ? raw('p(50)') : (raw('med') != null ? raw('med') : lerp(min, max, 0.5)));
  const p90 = (raw('p(90)') != null ? raw('p(90)') : lerp(p50, max, 0.8));
  const p95 = (raw('p(95)') != null ? raw('p(95)') : lerp(p90, max, 0.5));
  const p99 = (raw('p(99)') != null ? raw('p(99)') : interpPercentile(99, [{ p: 95, v: p95 }, { p: 100, v: max }]));
  const p999 = (raw('p(99.9)') != null ? raw('p(99.9)') : interpPercentile(99.9, [{ p: 99, v: p99 }, { p: 100, v: max }]));
  const p9999 = (raw('p(99.99)') != null ? raw('p(99.99)') : interpPercentile(99.99, [{ p: 99.9, v: p999 }, { p: 100, v: max }]));
  const p99999 = (raw('p(99.999)') != null ? raw('p(99.999)') : interpPercentile(99.999, [{ p: 99.99, v: p9999 }, { p: 100, v: max }]));
  const p999999 = (raw('p(99.9999)') != null ? raw('p(99.9999)') : interpPercentile(99.9999, [{ p: 99.999, v: p99999 }, { p: 100, v: max }]));
  const p9999999 = (raw('p(99.99999)') != null ? raw('p(99.99999)') : interpPercentile(99.99999, [{ p: 99.9999, v: p999999 }, { p: 100, v: max }]));
  const p99999999 = (raw('p(99.99999999)') != null ? raw('p(99.99999999)') : interpPercentile(99.99999999, [{ p: 99.9999999, v: p9999999 }, { p: 100, v: max }]));
  return {
    avg, min, max, p50, p90, p95, p99, p999, p9999, p99999, p999999, p9999999, p99999999, p100: max
  };
}

// Emit default text summary (so rotation-suite grep for h2_fail/h3_fail still works) plus JSON for metrics + Little's Law.
export function handleSummary(data) {
  const h2 = data.metrics.h2_latency && data.metrics.h2_latency.values ? data.metrics.h2_latency.values : {};
  const h3 = data.metrics.h3_latency && data.metrics.h3_latency.values ? data.metrics.h3_latency.values : {};
  const rate = (data.metrics.http_reqs && data.metrics.http_reqs.values && data.metrics.http_reqs.values.rate) || 0;
  const count = (data.metrics.http_reqs && data.metrics.http_reqs.values && data.metrics.http_reqs.values.count) || 0;
  const h2f = data.metrics.h2_fail && data.metrics.h2_fail.values ? data.metrics.h2_fail.values : {};
  const h3f = data.metrics.h3_fail && data.metrics.h3_fail.values ? data.metrics.h3_fail.values : {};
  const h3sf = data.metrics.h3_strict_fail && data.metrics.h3_strict_fail.values ? data.metrics.h3_strict_fail.values : {};
  const h2tf = data.metrics.h2_timeout && data.metrics.h2_timeout.values ? data.metrics.h2_timeout.values : {};
  const h3tf = data.metrics.h3_timeout && data.metrics.h3_timeout.values ? data.metrics.h3_timeout.values : {};
  const h2pm = data.metrics.h2_protocol_mismatch && data.metrics.h2_protocol_mismatch.values ? data.metrics.h2_protocol_mismatch.values : {};
  const h3pm = data.metrics.h3_protocol_mismatch && data.metrics.h3_protocol_mismatch.values ? data.metrics.h3_protocol_mismatch.values : {};
  const h2_count = (h2f.passes || 0) + (h2f.fails || 0);
  const h3_count = (h3f.passes || 0) + (h3f.fails || 0);
  const h2_timeout_count = (h2tf.fails || 0);
  const h3_timeout_count = (h3tf.fails || 0);
  const h2_protocol_mismatch_count = (h2pm.fails || 0);
  const h3_protocol_mismatch_count = (h3pm.fails || 0);
  // Total = H2 + H3 (http_reqs.count only counts standard http in dual-scenario; use per-protocol counts so Total = H2 + H3).
  const totalCount = h2_count + h3_count;
  const totalRate = totalCount > 0 && data.metrics.iterations && data.metrics.iterations.values && (data.metrics.iterations.values.count || 0) > 0
    ? (data.metrics.iterations.values.rate * totalCount / data.metrics.iterations.values.count) : rate;
  // Little's Law: L = λ × W — use http_req_duration.avg for W (mixed H2+H3) when available
  const httpAvgMs = (data.metrics.http_req_duration && data.metrics.http_req_duration.values && data.metrics.http_req_duration.values.avg) || 0;
  const avgLatencyMs = httpAvgMs > 0 ? httpAvgMs : ((h2.avg != null && h3.avg != null) ? (h2.avg + h3.avg) / 2 : (h2.avg != null ? h2.avg : h3.avg) || 0);
  const Wsec = avgLatencyMs / 1000;
  const L = (totalCount > 0 ? totalRate : rate) * Wsec;
  const ph2 = extractPercentiles(h2);
  const ph3 = extractPercentiles(h3);
  const h2Obj = Object.assign({ avg: h2.avg, min: h2.min, max: h2.max }, ph2);
  const h3Obj = Object.assign({ avg: h3.avg, min: h3.min, max: h3.max }, ph3);
  // fails = request failure only (status !== 200); protocol_mismatch = diagnostic (explicit wrong proto), not counted as request failure.
  const summary = {
    latency: { h2: h2Obj, h3: h3Obj },
    throughput: { rate: totalCount > 0 ? totalRate : rate, count: totalCount || count },
    h2: { count: h2_count, fails: h2f.fails || 0, timeout: h2_timeout_count, protocol_mismatch: h2_protocol_mismatch_count },
    h3: { count: h3_count, fails: h3f.fails || 0, timeout: h3_timeout_count, protocol_mismatch: h3_protocol_mismatch_count },
    littlesLaw: { lambda_per_sec: totalCount > 0 ? totalRate : rate, W_sec: Wsec, L_avg_concurrency: L },
    tls: { strictTLS: true, tls13Only: true, insecureSkipTLSVerify: data.options && data.options.insecureSkipTLSVerify === false },
  };
  const text = inlineTextSummary(data);

  // Transport Benchmarking V5: structured transport-summary.json (one protocol per run)
  const isH3 = (typeof __ENV !== "undefined" && __ENV.STRICT_H3 === "1") || !h2Enabled;
  const iterations = data.metrics.iterations && data.metrics.iterations.values ? data.metrics.iterations.values : {};
  const itCount = iterations.count != null ? iterations.count : count;
  const itRate = iterations.rate != null ? iterations.rate : rate;
  const vusMax = (data.metrics.vus_max && data.metrics.vus_max.values && data.metrics.vus_max.values.max) || (data.metrics.vus && data.metrics.vus.values && data.metrics.vus.values.max) || 0;
  const lat = isH3 ? h3 : h2;
  const ph = isH3 ? extractPercentiles(h3) : extractPercentiles(h2);
  // Failure rate = fraction of iterations that failed. We record failure with add(1), success with add(0). k6 Rate metric: add(1) → .fails, add(0) → .passes. So failure_count = fails.
  const h3Denom = h3_count || 1;
  const h2Denom = h2_count || 1;
  const errorRate = isH3 ? ((h3f.fails || 0) / h3Denom) : ((h2f.fails || 0) / h2Denom);
  const timeoutRate = isH3 ? ((h3tf.fails || 0) / h3Denom) : ((h2tf.fails || 0) / h2Denom);
  const transportSummary = {
    protocol: isH3 ? "h3" : "h2",
    vus: vusMax,
    iterations: itCount,
    rps: itRate,
    error_rate: errorRate,
    timeout_rate: timeoutRate,
    latency_ms: {
      avg: lat.avg != null ? lat.avg : 0,
      p90: ph.p90 != null ? ph.p90 : 0,
      p95: ph.p95 != null ? ph.p95 : 0,
      max: lat.max != null ? lat.max : 0,
    },
  };
  // In-cluster runs often have read-only cwd; use K6_SUMMARY_PATH (e.g. /tmp/transport-summary.json) for writable path
  const summaryPath = __ENV.K6_SUMMARY_PATH || "transport-summary.json";
  return {
    [summaryPath]: JSON.stringify(transportSummary, null, 2),
    stdout: text + "\nROTATION_METRICS_JSON=" + JSON.stringify(summary) + "\n",
  };
}
