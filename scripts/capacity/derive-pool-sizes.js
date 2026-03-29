#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    perfDir: "",
    util: 0.75,
    minPool: 5,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--perf-dir") out.perfDir = args[i + 1] || "", i += 1;
    else if (a === "--util") out.util = Number(args[i + 1] || "0.75"), i += 1;
    else if (a === "--min-pool") out.minPool = Number(args[i + 1] || "5"), i += 1;
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ceil(n) {
  return Math.ceil(Number(n) || 0);
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir
    ? path.resolve(args.perfDir)
    : path.join(repoRoot, "bench_logs", "performance-lab");
  const util = Number.isFinite(args.util) && args.util > 0 && args.util < 1 ? args.util : 0.75;
  const minPool = Number.isFinite(args.minPool) && args.minPool > 0 ? Math.floor(args.minPool) : 5;

  const serviceModelsPath = path.join(perfDir, "service-models.json");
  const collapsePath = path.join(perfDir, "collapse-summary.json");
  const meritPath = path.join(perfDir, "protocol-merit.json");
  const classPath = path.join(perfDir, "service-classification.json");
  if (!fs.existsSync(serviceModelsPath) || !fs.existsSync(collapsePath) || !fs.existsSync(classPath)) {
    console.error(`Missing required performance-lab inputs in ${perfDir}`);
    process.exit(1);
  }

  const serviceModels = readJson(serviceModelsPath);
  const collapseSummary = readJson(collapsePath);
  const protocolMerit = fs.existsSync(meritPath) ? readJson(meritPath) : [];
  const classifications = readJson(classPath);

  const modelByService = new Map(serviceModels.map((x) => [x.service, x]));
  const meritByService = new Map(protocolMerit.map((x) => [x.service, x]));
  const classByService = new Map(classifications.map((x) => [x.service, x]));

  const recommendations = [];
  for (const entry of collapseSummary) {
    const service = entry.service;
    const protocols = entry.protocols || {};
    const peakRps = Math.max(
      Number(protocols.http1?.max_rps_pre_collapse || 0),
      Number(protocols.http2?.max_rps_pre_collapse || 0),
      Number(protocols.http3?.max_rps_pre_collapse || 0),
    );
    const model = modelByService.get(service);
    const mu = Number(model?.mu_estimated_rps_per_slot || 0);
    const classification = classByService.get(service)?.classification || "UNKNOWN";
    // Current stack: gateway is edge-only; the other services are DB-backed workloads.
    const isDbBackedService = service !== "gateway";
    const computedPool = isDbBackedService && mu > 0 ? ceil(peakRps / (mu * util)) : null;
    const recommendedPool = computedPool == null ? null : Math.max(minPool, computedPool);
    const streamCap = recommendedPool ? Math.max(8, ceil(recommendedPool / 2)) : 16;
    const safeRps = isDbBackedService && mu > 0 && recommendedPool
      ? Number((recommendedPool * mu * util).toFixed(2))
      : Number((peakRps * 0.8).toFixed(2));
    recommendations.push({
      service,
      classification,
      mu_rps_per_db_slot: mu > 0 ? Number(mu.toFixed(4)) : null,
      peak_rps_pre_collapse: Number(peakRps.toFixed(2)),
      safe_utilization_target: util,
      min_pool_floor: minPool,
      recommended_pool: recommendedPool,
      recommended_max_inflight: recommendedPool || 20,
      recommended_http2_stream_cap: streamCap,
      recommended_http3_stream_cap: streamCap,
      recommended_safe_rps: safeRps,
      merit_hint: meritByService.get(service)?.merit || null,
    });
  }
  recommendations.sort((a, b) => a.service.localeCompare(b.service));

  const recPath = path.join(perfDir, "capacity-recommendations.json");
  fs.writeFileSync(
    recPath,
    `${JSON.stringify({ generated_at: new Date().toISOString(), recommendations }, null, 2)}\n`,
    "utf8",
  );

  const md = [];
  md.push("# Ingress and Concurrency Tuning");
  md.push("");
  md.push(`Utilization target: ${util}`);
  md.push("");
  md.push("| Service | Class | Safe RPS | Pool | MAX_DB_CONCURRENCY | h2 stream cap | h3 stream cap |");
  md.push("|---|---|---:|---:|---:|---:|---:|");
  for (const r of recommendations) {
    md.push(`| ${r.service} | ${r.classification} | ${r.recommended_safe_rps} | ${r.recommended_pool ?? "n/a"} | ${r.recommended_max_inflight} | ${r.recommended_http2_stream_cap} | ${r.recommended_http3_stream_cap} |`);
  }
  md.push("");
  md.push("## NGINX/Caddy Guidance");
  md.push("");
  md.push("- Set per-service request rate ceilings near `recommended_safe_rps`.");
  md.push("- For HTTP/2, tune `http2_max_concurrent_streams` toward per-service stream cap.");
  md.push("- For HTTP/3, tune QUIC max streams similarly; avoid oversized initial burst windows.");
  md.push("- Keep app-level semaphore (`MAX_DB_CONCURRENCY`) aligned with DB pool.");
  md.push("");
  fs.writeFileSync(path.join(perfDir, "ingress-tuning.md"), `${md.join("\n")}\n`, "utf8");

  const dashboardSchema = {
    version: 1,
    description: "Capacity envelope dashboard fields by service and protocol.",
    metrics: [
      "service",
      "protocol",
      "current_rps",
      "safe_rps",
      "pool_size",
      "mu_rps_per_db_slot",
      "estimated_utilization",
      "inflight_requests",
      "db_waiters",
      "p95_waiting_ms",
      "fail_rate",
      "collapse_detected",
      "collapse_reason",
    ],
    derived_formulas: {
      estimated_utilization: "current_rps / (pool_size * mu_rps_per_db_slot)",
      collapse_detected: "fail_rate > 0.02 || p95_waiting_ms > (3 * baseline_p95_waiting_ms)",
    },
  };
  fs.writeFileSync(
    path.join(perfDir, "capacity-dashboard-schema.json"),
    `${JSON.stringify(dashboardSchema, null, 2)}\n`,
    "utf8",
  );

  console.log(`Wrote ${recPath}`);
  console.log(`Wrote ${path.join(perfDir, "ingress-tuning.md")}`);
  console.log(`Wrote ${path.join(perfDir, "capacity-dashboard-schema.json")}`);
}

main();
