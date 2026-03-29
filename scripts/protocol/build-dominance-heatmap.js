#!/usr/bin/env node
/**
 * Synthetic transport-dominance grid: pool × μ scale → region {http2-dominant|http3-dominant|backend-bound}
 * Uses HTTP/2 and HTTP/3 μ from service-model.json (ceiling run).
 *
 *   node scripts/protocol/build-dominance-heatmap.js \
 *     --service-model bench_logs/ceiling/<stamp>/service-model.json \
 *     [--out-dir bench_logs/performance-lab]
 */
const fs = require("fs");
const path = require("path");

function mergeProtocols(protocols) {
  const by = new Map();
  for (const p of protocols || []) {
    const k = p.protocol;
    if (!k) continue;
    const prev = by.get(k);
    const rps = Number(p.rps) || 0;
    if (!prev || rps > (Number(prev.rps) || 0)) by.set(k, p);
  }
  return by;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  let serviceModelPath = "";
  let outDir = path.join(repoRoot, "bench_logs", "performance-lab");
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--service-model") serviceModelPath = path.resolve(a[++i] || "");
    else if (a[i] === "--out-dir") outDir = path.resolve(a[++i] || "");
  }
  if (!serviceModelPath || !fs.existsSync(serviceModelPath)) {
    console.error("Missing --service-model path to service-model.json");
    process.exit(1);
  }
  const model = JSON.parse(fs.readFileSync(serviceModelPath, "utf8"));
  const output = {};
  const poolMin = 5;
  const poolMax = 40;
  const muScaleMin = 0.5;
  const muScaleMax = 2.0;
  const muStep = 0.1;

  for (const block of model.services || []) {
    const name = block.service;
    const by = mergeProtocols(block.protocols);
    const h2 = by.get("http2");
    const h3 = by.get("http3");
    const mu2 = h2 && h2.mu_estimated_rps_per_slot != null ? Number(h2.mu_estimated_rps_per_slot) : null;
    const mu3 = h3 && h3.mu_estimated_rps_per_slot != null ? Number(h3.mu_estimated_rps_per_slot) : null;
    let collapseRps = 0;
    for (const pr of ["http1", "http2", "http3"]) {
      const p = by.get(pr);
      const r = p ? Number(p.rps) || 0 : 0;
      if (r > collapseRps) collapseRps = r;
    }
    if (mu2 == null || mu3 == null || !Number.isFinite(mu2) || !Number.isFinite(mu3)) {
      output[name] = { skip: true, reason: "missing mu for http2 or http3" };
      continue;
    }

    const grid = [];
    for (let pool = poolMin; pool <= poolMax; pool += 1) {
      for (let s = muScaleMin; s <= muScaleMax + 1e-9; s += muStep) {
        const scaledMu2 = mu2 * s;
        const scaledMu3 = mu3 * s;
        const h2Cap = scaledMu2 * pool;
        const h3Cap = scaledMu3 * pool;
        let region;
        if (collapseRps > 0 && h2Cap >= collapseRps && h3Cap >= collapseRps) region = "backend-bound";
        else if (h3Cap > h2Cap) region = "http3-dominant";
        else region = "http2-dominant";
        grid.push({ pool, mu_scale: Number(s.toFixed(2)), region });
      }
    }
    output[name] = {
      mu_http2: mu2,
      mu_http3: mu3,
      reference_rps_max: collapseRps,
      pool_range: [poolMin, poolMax],
      mu_scale_range: [muScaleMin, muScaleMax],
      grid,
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "transport-dominance-heatmap.json");
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source_service_model: serviceModelPath,
        services: output,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Wrote ${out}`);
}

main();
