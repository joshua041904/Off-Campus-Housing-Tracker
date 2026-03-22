import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate } from 'k6/metrics';
import { mergeEdgeTls, strictEdgeTlsOptions } from './k6-strict-edge-tls.js';

// -------- env --------
const RAW_BASE = (__ENV.BASE_URL || 'http://nginx:8080').replace(/\/$/, '');
const HAS_API  = RAW_BASE.endsWith('/api');
const BASE     = RAW_BASE;
const TOKEN    = __ENV.TOKEN || '';
const MODE     = (__ENV.MODE || 'rate').toLowerCase(); // rate | sweep | soak
const RATE     = Number(__ENV.RATE || 0);
const VUS      = Number(__ENV.VUS || 50);
const DUR      = __ENV.DURATION || '30s';
const ACCEPT_429 = (__ENV.ACCEPT_429 || '1') === '1';
const SYNTH_IP   = (__ENV.SYNTH_IP   || '1') === '1';
const MAX_VUS    = Number(__ENV.MAX_VUS || 200);
// optional sweep env: STAGES="100,200,300,400" or RATE_START/RATE_STEP/STEPS/STEP_DUR
const STAGES_CSV = __ENV.STAGES || '';          // e.g. "100,200,300,400"
const RATE_START = Number(__ENV.RATE_START || 100);
const RATE_STEP  = Number(__ENV.RATE_STEP  || 100);
const STEPS      = Number(__ENV.STEPS      || 5);
const STEP_DUR   = __ENV.STEP_DUR || '60s';

export const errors = new Rate('errors');

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 399 }, 404, 409, 429)
);

// -------- thresholds (reads are strict; RELAXED_THRESHOLDS=1 for adversarial/stress to capture metrics) --------
const RELAXED = (__ENV.RELAXED_THRESHOLDS || '0') === '1';
const thresholds = RELAXED
  ? {
      errors: ['rate<0.70'],
      http_req_failed: ['rate<0.70'],
      'http_req_duration': ['p(95)<5000', 'p(99)<15000'],
    }
  : {
      errors: ['rate<0.01'],
      'http_req_duration{method:GET}': [
        'p(50)<25', 'p(95)<50', 'p(99)<120',
        'p(99.9)<300', 'p(99.99)<600', 'p(99.999)<1200',
        'p(99.9999)<3000', 'p(99.99999)<6000', 'p(100)<12000'
      ],
      http_req_failed: ['rate<0.005'],
      'http_req_duration': [
        'p(50)<30', 'p(95)<60', 'p(99)<150',
        'p(99.9)<400', 'p(99.99)<800', 'p(99.999)<1600',
        'p(99.9999)<4000', 'p(99.99999)<8000', 'p(100)<16000'
      ],
    };

// -------- options builder (hosts + CA preload via strictEdgeTlsOptions) --------
function buildOptions() {
  const systemTags = ['status','method','name','scenario','expected_response'];
  const withEdge = (opts) => ({ ...strictEdgeTlsOptions(RAW_BASE), ...opts });

  if (MODE === 'sweep') {
    let stages = [];
    if (STAGES_CSV) {
      const nums = STAGES_CSV.split(',').map(s => Number(s.trim())).filter(n => n > 0);
      stages = nums.map(n => ({ target: n, duration: STEP_DUR }));
    } else {
      for (let i = 0; i < STEPS; i++) {
        stages.push({ target: RATE_START + i * RATE_STEP, duration: STEP_DUR });
      }
    }
    return withEdge({
      scenarios: {
        sweep: {
          executor: 'ramping-arrival-rate',
          startRate: (stages[0] && stages[0].target) ? stages[0].target : 1,
          timeUnit: '1s',
          preAllocatedVUs: VUS,
          maxVUs: Math.max(VUS, MAX_VUS),
          stages,
        },
      },
      thresholds,
      systemTags,
    });
  }

  if (MODE === 'rate' || RATE > 0) {
    return withEdge({
      scenarios: {
        rate: {
          executor: 'constant-arrival-rate',
          rate: RATE || 300,
          timeUnit: '1s',
          duration: DUR,
          preAllocatedVUs: VUS,
          maxVUs: Math.max(VUS, MAX_VUS),
        },
      },
      thresholds,
      systemTags,
    });
  }

  // default "simple" or soak style (no rate provided -> VU/duration)
  return withEdge({ vus: VUS, duration: DUR, thresholds, systemTags });
}
export const options = buildOptions();

// -------- helpers --------
const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

function makeHeaders() {
  const ip = SYNTH_IP ? `10.0.${__VU}.${__ITER % 250}` : '';
  const h = {};
  if ((__ENV.NO_LIMIT === '1') || BASE.includes(':8082')) h['X-Loadtest'] = '1';
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  if (ip) h['X-Forwarded-For'] = ip;
  return h;
}

// -------- test loop --------
export default function () {
  const headers = makeHeaders();
  const res = http.get(api('/records'), mergeEdgeTls(RAW_BASE, { headers, tags: { name: 'GET /records' } }));
  const ok = res.status === 200 || (ACCEPT_429 && res.status === 429);
  errors.add(!ok);
  check(res, { 'ok(200|429)': () => ok });

  if (!RATE && MODE !== 'sweep') sleep(0.5);
}

// Comprehensive latency summary handler: compute ALL percentiles (interpolate when k6 omits), Little's Law
function lerp(a, b, t) {
  if (a == null || b == null || typeof a !== 'number' || typeof b !== 'number') return a ?? b ?? 0;
  return a + (b - a) * t;
}

// Interpolate percentile from known anchors: (pct, anchors) -> value. anchors = [{p:0,v:min},{p:95,v:p95},{p:100,v:max}]
function interpPercentile(pct, anchors) {
  const sorted = anchors.filter((x) => x.v != null && typeof x.v === 'number').sort((a, b) => a.p - b.p);
  if (sorted.length === 0) return 0;
  if (pct <= sorted[0].p) return sorted[0].v;
  if (pct >= sorted[sorted.length - 1].p) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (pct >= lo.p && pct <= hi.p) {
      const t = (pct - lo.p) / (hi.p - lo.p);
      return lerp(lo.v, hi.v, t);
    }
  }
  return sorted[sorted.length - 1].v;
}

export function handleSummary(data) {
  const raw = (m, k) => (m && m.values && m.values[k]) != null ? m.values[k] : null;

  const extractPercentiles = (metric) => {
    if (!metric || !metric.values) return {};
    const v = metric.values;
    const min = v.min ?? 0;
    const max = v.max ?? v['p(100)'] ?? min;
    const avg = v.avg ?? (min + max) / 2;
    const p95 = raw(metric, 'p(95)') ?? lerp(min, max, 0.95);
    const p50Raw = raw(metric, 'p(50)') ?? raw(metric, 'med');
    const anchors = [
      { p: 0, v: min },
      { p: 95, v: p95 },
      { p: 100, v: max },
    ];
    // Always compute every percentile: use k6 value when present, else interpolate between anchors
    return {
      p50: p50Raw ?? interpPercentile(50, anchors),
      p95: p95,
      p99: raw(metric, 'p(99)') ?? interpPercentile(99, anchors),
      p999: raw(metric, 'p(99.9)') ?? interpPercentile(99.9, anchors),
      p9999: raw(metric, 'p(99.99)') ?? interpPercentile(99.99, anchors),
      p99999: raw(metric, 'p(99.999)') ?? interpPercentile(99.999, anchors),
      p999999: raw(metric, 'p(99.9999)') ?? interpPercentile(99.9999, anchors),
      p9999999: raw(metric, 'p(99.99999)') ?? interpPercentile(99.99999, anchors),
      p100: max,
      avg,
      min,
      max,
    };
  };

  const totalRequests = (data.metrics.http_reqs?.values?.count) ?? 0;
  const avgMs = (data.metrics.http_req_duration?.values?.avg) ?? 0;
  const testDurationSec = parseDurationSec(DUR);
  const arrivalRate = RATE > 0 ? RATE : (testDurationSec > 0 && totalRequests > 0 ? totalRequests / testDurationSec : 0);
  // Little's Law: L = λ × W  (concurrent = arrival_rate × avg_residence_time_sec)
  const littlesLaw = {
    arrival_rate_req_s: arrivalRate,
    avg_latency_sec: avgMs > 0 ? avgMs / 1000 : 0,
    concurrent_estimate: arrivalRate > 0 && avgMs > 0 ? arrivalRate * (avgMs / 1000) : 0,
    formula: 'L = λ × W (concurrent requests ≈ arrival_rate × avg_latency_sec)',
  };

  const latencyReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total_requests: totalRequests,
      avg_latency_ms: avgMs,
      error_rate: (data.metrics.errors?.values?.rate) ?? 0,
      http_req_failed_rate: (data.metrics.http_req_failed?.values?.rate) ?? null,
      littles_law: littlesLaw,
    },
    latency_metrics: {},
  };

  for (const [key, metric] of Object.entries(data.metrics)) {
    if (key.startsWith('http_req_duration')) {
      latencyReport.latency_metrics[key] = extractPercentiles(metric);
    }
  }

  const fmt = (n) => (n != null && typeof n === 'number' ? n.toFixed(2) : '—');
  console.log('\n=== Comprehensive Latency Metrics (Reads) ===');
  console.log(`\nLittle's Law: L = λ × W`);
  console.log(`  arrival_rate (λ): ${littlesLaw.arrival_rate_req_s.toFixed(1)} req/s`);
  console.log(`  avg_latency (W):  ${(littlesLaw.avg_latency_sec * 1000).toFixed(2)} ms`);
  console.log(`  concurrent (L):   ${littlesLaw.concurrent_estimate.toFixed(1)} (estimated)`);
  for (const [key, metrics] of Object.entries(latencyReport.latency_metrics)) {
    console.log(`\n${key}:`);
    console.log(`  p50:      ${fmt(metrics.p50)} ms`);
    console.log(`  p95:      ${fmt(metrics.p95)} ms`);
    console.log(`  p99:      ${fmt(metrics.p99)} ms`);
    console.log(`  p999:     ${fmt(metrics.p999)} ms`);
    console.log(`  p9999:    ${fmt(metrics.p9999)} ms`);
    console.log(`  p99999:   ${fmt(metrics.p99999)} ms`);
    console.log(`  p999999:  ${fmt(metrics.p999999)} ms`);
    console.log(`  p9999999: ${fmt(metrics.p9999999)} ms`);
    console.log(`  p100:     ${fmt(metrics.p100)} ms`);
    console.log(`  avg:      ${fmt(metrics.avg)} ms`);
  }

  return {
    'stdout': JSON.stringify(latencyReport, null, 2),
    'k6-latency-report.json': JSON.stringify(latencyReport, null, 2),
  };
}

function parseDurationSec(d) {
  if (!d || typeof d !== 'string') return 0;
  const m = d.match(/^(\d+)(s|m|h)?$/i);
  if (!m) return 0;
  let n = parseInt(m[1], 10);
  const u = (m[2] || 's').toLowerCase();
  if (u === 'm') n *= 60;
  else if (u === 'h') n *= 3600;
  return n;
}
