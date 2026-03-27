#!/usr/bin/env node
/**
 * Suggest DB pool sizes from observed request rate λ (RPS) and μ from service-models.json:
 *   pool >= ceil(λ / (μ * target_utilization))   (Little's Law style, same as derive-pool-sizes)
 *
 * Default target_utilization = 0.75. Does not mutate cluster — prints JSON for operators / future controller.
 *
 *   node scripts/protocol/adaptive-pool-suggest.js [--perf-dir DIR] [--observed-rps PATH] [--util 0.75] [--min-pool 5]
 *
 * observed-rps JSON shape: { "analytics": 120.5, "auth": 200 }  (RPS per service name)
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { perfDir: "", observedPath: "", util: 0.75, minPool: 5 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") {
      out.perfDir = path.resolve(a[++i] || "");
    } else if (a[i] === "--observed-rps") {
      out.observedPath = path.resolve(a[++i] || "");
    } else if (a[i] === "--util") {
      out.util = Number(a[++i] || "0.75");
    } else if (a[i] === "--min-pool") {
      out.minPool = Number(a[++i] || "5");
    }
  }
  return out;
}

function ceil(n) {
  return Math.ceil(Number(n) || 0);
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const modelsPath = path.join(perfDir, "service-models.json");

  if (!fs.existsSync(modelsPath)) {
    console.error(`adaptive-pool-suggest: missing ${modelsPath}`);
    process.exit(1);
  }

  const util = Number.isFinite(args.util) && args.util > 0 && args.util < 1 ? args.util : 0.75;
  const minPool = Number.isFinite(args.minPool) && args.minPool > 0 ? Math.floor(args.minPool) : 5;

  let observed = {};
  if (args.observedPath) {
    if (!fs.existsSync(args.observedPath)) {
      console.error(`adaptive-pool-suggest: missing --observed-rps file ${args.observedPath}`);
      process.exit(1);
    }
    observed = JSON.parse(fs.readFileSync(args.observedPath, "utf8"));
  }

  const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  const suggestions = [];

  for (const m of models) {
    const service = m.service;
    const mu = Number(m.mu_estimated_rps_per_slot || 0);
    const lambda = observed[service];
    if (lambda == null || !Number.isFinite(Number(lambda))) {
      suggestions.push({
        service,
        mu_rps_per_db_slot: mu > 0 ? Number(mu.toFixed(4)) : null,
        observed_rps: null,
        suggested_pool: null,
        note: "no observed_rps in input — add key to --observed-rps JSON",
      });
      continue;
    }
    const lam = Number(lambda);
    if (service === "gateway" || mu <= 0) {
      suggestions.push({
        service,
        mu_rps_per_db_slot: mu > 0 ? Number(mu.toFixed(4)) : null,
        observed_rps: lam,
        suggested_pool: null,
        note: service === "gateway" ? "gateway: use GATEWAY_PROXY_MAX_INFLIGHT / edge limits, not DB pool" : "μ unavailable",
      });
      continue;
    }
    const raw = ceil(lam / (mu * util));
    const suggested = Math.max(minPool, raw);
    suggestions.push({
      service,
      mu_rps_per_db_slot: Number(mu.toFixed(4)),
      observed_rps: lam,
      target_utilization: util,
      min_pool_floor: minPool,
      suggested_pool: suggested,
      suggested_max_inflight: suggested,
      formula: `ceil(${lam} / (${mu} * ${util})) floored at min_pool ${minPool}`,
    });
  }

  suggestions.sort((a, b) => a.service.localeCompare(b.service));
  const out = {
    generated_at: new Date().toISOString(),
    target_utilization: util,
    note: "Advisory only — compare with capacity-recommendations.json and strict-envelope.json before applying.",
    suggestions,
  };
  console.log(`${JSON.stringify(out, null, 2)}\n`);
}

main();
