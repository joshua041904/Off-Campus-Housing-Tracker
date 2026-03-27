#!/usr/bin/env node
/**
 * Fail if performance-lab capacity recommendations exceed the declared production envelope:
 *   recommended_pool > configured_db_pool_max
 *   recommended_http{2,3}_stream_cap > ingress http{2,3}_max_concurrent_streams
 *
 * Usage:
 *   node scripts/protocol/strict-envelope-check.js [--perf-dir DIR] [--envelope PATH]
 *
 * Exit 0 if bench_logs lab files are missing (opt-in when present), unless --require-lab.
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { perfDir: "", envelope: "", requireLab: false };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") out.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--envelope") out.envelope = path.resolve(a[++i] || "");
    else if (a[i] === "--require-lab") out.requireLab = true;
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const envelopePath =
    args.envelope || path.join(repoRoot, "infra", "k8s", "base", "config", "strict-envelope.json");
  const recPath = path.join(perfDir, "capacity-recommendations.json");

  if (!fs.existsSync(envelopePath)) {
    console.error(`strict-envelope-check: missing envelope file: ${envelopePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(recPath)) {
    if (args.requireLab) {
      console.error(`strict-envelope-check: missing ${recPath} (--require-lab)`);
      process.exit(1);
    }
    console.log(
      "strict-envelope-check: skip (no capacity-recommendations.json — run make capacity-recommend or capacity-one)",
    );
    process.exit(0);
  }

  const envelope = readJson(envelopePath);
  const { recommendations } = readJson(recPath);
  const services = envelope.services || {};
  const ingress = envelope.ingress || {};
  const h2Cap = Number(ingress.http2_max_concurrent_streams);
  const h3Cap = Number(ingress.http3_max_concurrent_streams);
  const failures = [];

  if (!Number.isFinite(h2Cap) || h2Cap <= 0) failures.push("ingress.http2_max_concurrent_streams must be a positive number");
  if (!Number.isFinite(h3Cap) || h3Cap <= 0) failures.push("ingress.http3_max_concurrent_streams must be a positive number");

  for (const row of recommendations || []) {
    const name = row.service;
    if (!name) continue;
    const decl = services[name];
    if (!decl) {
      failures.push(`${name}: not listed in strict-envelope.json services (add configured_db_pool_max or gateway fields)`);
      continue;
    }

    const recPool = row.recommended_pool;
    if (recPool != null && Number.isFinite(Number(recPool))) {
      const cfg = decl.configured_db_pool_max;
      if (cfg == null || !Number.isFinite(Number(cfg))) {
        failures.push(
          `${name}: lab recommends pool ${recPool} but strict-envelope has no configured_db_pool_max`,
        );
      } else if (Number(recPool) > Number(cfg)) {
        failures.push(
          `${name}: recommended_pool ${recPool} > configured_db_pool_max ${cfg}`,
        );
      }
    }

    if (name === "gateway" || (recPool == null && decl.configured_gateway_proxy_max_inflight != null)) {
      const recInflight = row.recommended_max_inflight;
      const gwCap = decl.configured_gateway_proxy_max_inflight;
      if (recInflight != null && Number.isFinite(Number(recInflight)) && gwCap != null) {
        if (Number(recInflight) > Number(gwCap)) {
          failures.push(
            `${name}: recommended_max_inflight ${recInflight} > configured_gateway_proxy_max_inflight ${gwCap}`,
          );
        }
      }
    }

    const h2Rec = row.recommended_http2_stream_cap;
    const h3Rec = row.recommended_http3_stream_cap;
    if (h2Rec != null && Number(h2Rec) > h2Cap) {
      failures.push(
        `${name}: recommended_http2_stream_cap ${h2Rec} > ingress http2_max_concurrent_streams ${h2Cap}`,
      );
    }
    if (h3Rec != null && Number(h3Rec) > h3Cap) {
      failures.push(
        `${name}: recommended_http3_stream_cap ${h3Rec} > ingress http3_max_concurrent_streams ${h3Cap}`,
      );
    }
  }

  if (failures.length) {
    console.error("strict-envelope-check: FAILED");
    for (const f of failures) console.error(`  • ${f}`);
    console.error("\nFix: raise pools / ingress caps in infra/k8s/base/config/strict-envelope.json and cluster, or refresh lab after tuning.");
    process.exit(1);
  }

  console.log("strict-envelope-check: OK (pool and stream caps cover lab recommendations)");
}

main();
