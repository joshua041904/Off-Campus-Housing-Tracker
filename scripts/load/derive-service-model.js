#!/usr/bin/env node
/**
 * Derive simple capacity/model hints from protocol-comparison.csv using Little's Law.
 *
 * Usage:
 *   node scripts/load/derive-service-model.js
 *   node scripts/load/derive-service-model.js bench_logs/protocol-comparison.csv
 *
 * Env:
 *   SERVICE_MODEL_OUT=/path/service-model.json
 *   MODEL_POOL_SIZES=10,20,30
 *   MODEL_TARGET_UTIL=0.8
 */
const fs = require("fs");
const path = require("path");

function splitCsv(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function classifyTail(tailRatio, maxRatio) {
  if (tailRatio == null || maxRatio == null) return "unknown";
  if (tailRatio > 5 || maxRatio > 8) return "high";
  if (tailRatio > 3 || maxRatio > 5) return "moderate";
  return "low";
}

// Acklam inverse-normal approximation for 0<p<1.
function invNorm(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function modeledExtremePercentiles(p50, p95, p99, maxObserved) {
  if (!Number.isFinite(p50) || p50 <= 0 || !Number.isFinite(p95) || p95 <= 0 || p95 < p50) {
    return null;
  }
  // Log-normal fit anchored on p50 and p95.
  const mu = Math.log(p50);
  const z95 = invNorm(0.95);
  const sigma = z95 > 0 ? (Math.log(p95) - mu) / z95 : NaN;
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  const targets = {
    p999: 0.999,
    p9999: 0.9999,
    p99999: 0.99999,
    p999999: 0.999999,
    p9999999: 0.9999999,
    p99999999: 0.99999999,
  };
  const out = {};
  for (const [k, p] of Object.entries(targets)) {
    const z = invNorm(p);
    out[`${k}_ms`] = Number.isFinite(z) ? Math.exp(mu + sigma * z) : null;
  }
  out.p100_observed_ms = Number.isFinite(maxObserved) ? maxObserved : null;
  // p100 is unbounded in continuous models; expose conservative modeled p100 as max(observed, p99.999999).
  out.p100_modeled_ms = Math.max(
    Number.isFinite(maxObserved) ? maxObserved : 0,
    Number.isFinite(out.p99999999_ms) ? out.p99999999_ms : 0,
  ) || null;
  out.model = "lognormal_fit(p50,p95)";
  out.tail_ratio_p95_over_p50 = p95 / p50;
  out.tail_ratio_p99_over_p95 = Number.isFinite(p99) && p95 > 0 ? p99 / p95 : null;
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const flagsWithValue = new Set(["--service", "--pools"]);
  const getArg = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : "";
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (flagsWithValue.has(a)) i += 1;
      continue;
    }
    positional.push(a);
  }
  const positionalCsv = positional[0] || "";
  const onlyService = getArg("--service");
  const allServices = args.includes("--all");
  const repoRoot = path.resolve(__dirname, "../..");
  const csvPath = positionalCsv
    ? path.resolve(positionalCsv)
    : path.join(repoRoot, "bench_logs", "protocol-comparison.csv");
  const outPath = process.env.SERVICE_MODEL_OUT
    ? path.resolve(process.env.SERVICE_MODEL_OUT)
    : path.join(repoRoot, "bench_logs", "service-model.json");
  const poolsArg = getArg("--pools");
  const poolSizes = (poolsArg || process.env.MODEL_POOL_SIZES || "10,20,30")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const targetUtil = Number(process.env.MODEL_TARGET_UTIL || "0.8");

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(csvPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) {
    console.error(`CSV has no data rows: ${csvPath}`);
    process.exit(1);
  }

  const header = splitCsv(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const protocolShape = ["service", "protocol", "p50", "p95", "max", "avg", "rps", "fail_rate"];
  const ceilingShape = ["service", "protocol", "p50_waiting_ms", "p95_waiting_ms", "max_waiting_ms", "avg_waiting_ms", "rps", "fail_rate"];
  const hasProtocolShape = protocolShape.every((k) => k in idx);
  const hasCeilingShape = ceilingShape.every((k) => k in idx);
  if (!hasProtocolShape && !hasCeilingShape) {
    console.error("CSV schema not recognized; expected protocol-comparison.csv or run-service-ceiling results.csv");
    process.exit(1);
  }

  const byService = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsv(lines[i]);
    const service = row[idx.service];
    if (!service) continue;
    const protocol = row[idx.protocol] || "unknown";
    const p50 = hasProtocolShape ? num(row[idx.p50]) : num(row[idx.p50_waiting_ms]);
    const p95 = hasProtocolShape ? num(row[idx.p95]) : num(row[idx.p95_waiting_ms]);
    const p99 = hasProtocolShape ? num(row[idx.p99]) : num(row[idx.p99_waiting_ms]);
    const max = hasProtocolShape ? num(row[idx.max]) : num(row[idx.max_waiting_ms]);
    const avg = hasProtocolShape ? num(row[idx.avg]) : num(row[idx.avg_waiting_ms]);
    const rps = num(row[idx.rps]);
    const failRate = num(row[idx.fail_rate]) || 0;

    if (avg == null || rps == null) continue;
    const wAvgSec = avg / 1000.0;
    const lEstimated = rps * wAvgSec;
    const muEstimated = wAvgSec > 0 ? 1.0 / wAvgSec : null;
    const utilByPool = {};
    const safeRpsByPool = {};
    for (const p of poolSizes) {
      utilByPool[p] = muEstimated ? rps / (p * muEstimated) : null;
      safeRpsByPool[p] = muEstimated ? targetUtil * p * muEstimated : null;
    }

    const tailRatio = p50 && p95 ? p95 / p50 : null;
    const maxRatio = p95 && max ? max / p95 : null;
    const extreme = modeledExtremePercentiles(p50, p95, p99, max);
    const point = {
      protocol,
      rps,
      fail_rate: failRate,
      p50_ms: p50,
      p95_ms: p95,
      p99_ms: p99,
      max_ms: max,
      avg_waiting_ms: avg,
      w_avg_sec: wAvgSec,
      l_estimated: lEstimated,
      mu_estimated_rps_per_slot: muEstimated,
      utilization_by_pool: utilByPool,
      predicted_safe_rps_by_pool: safeRpsByPool,
      tail_ratio_p95_over_p50: tailRatio,
      max_ratio_over_p95: maxRatio,
      tail_amplification: classifyTail(tailRatio, maxRatio),
      modeled_extreme_percentiles_ms: extreme,
    };
    if (!byService.has(service)) byService.set(service, []);
    byService.get(service).push(point);
  }

  const services = [];
  for (const [service, points] of byService.entries()) {
    if (!allServices && onlyService && service !== onlyService) continue;
    points.sort((a, b) => (a.p95_ms ?? Infinity) - (b.p95_ms ?? Infinity));
    const best = points.find((p) => Number.isFinite(p.p95_ms) && p.fail_rate < 0.02) || points[0];
    services.push({
      service,
      best_protocol: best?.protocol || "unknown",
      protocols: points,
    });
  }
  services.sort((a, b) => a.service.localeCompare(b.service));

  const model = {
    source_csv: csvPath,
    generated_at: new Date().toISOString(),
    model_assumptions: {
      little_law: "L = lambda * W",
      mu_estimated_from_avg_waiting: "mu ~= 1 / W_avg",
      target_utilization_for_safe_rps: targetUtil,
      pool_sizes: poolSizes,
    },
    services,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(model, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} for ${services.length} services`);
}

main();
