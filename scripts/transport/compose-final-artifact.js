#!/usr/bin/env node
/**
 * Single composed artifact for readiness + dashboards (transport lab + performance lab + endpoint coverage).
 *
 *   node scripts/transport/compose-final-artifact.js [--transport-dir DIR] [--perf-dir DIR] [--out PATH]
 *
 * QUIC: when bench_logs/transport-lab/quic/analysis/dominance-map.json exists, quic_pipeline is "integrated".
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { transportDir: "", perfDir: "", out: "" };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--transport-dir") o.transportDir = path.resolve(a[++i] || "");
    else if (a[i] === "--perf-dir") o.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--out") o.out = path.resolve(a[++i] || "");
  }
  return o;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function gitSha(repoRoot) {
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const transportDir = args.transportDir || path.join(repoRoot, "bench_logs", "transport-lab");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const outPath =
    args.out || path.join(transportDir, "final-transport-artifact.json");

  const tv = readJson(path.join(transportDir, "transport-validation-report.json"));
  const down = readJson(path.join(transportDir, "downgrade-detection-report.json"));
  const integrity = readJson(path.join(transportDir, "protocol-integrity-report.json"));
  const collapseSmoke = readJson(path.join(transportDir, "collapse-smoke-report.json"));
  const coverage = readJson(path.join(perfDir, "endpoint-coverage-report.json"));
  const matrix = readJson(path.join(perfDir, "protocol-happiness-matrix.json"));
  const collapse = readJson(path.join(perfDir, "collapse-summary.json"));
  const capacity = readJson(path.join(perfDir, "capacity-recommendations.json"));

  const perService = {};
  const names = new Set();
  if (tv && tv.services) {
    for (const [k, v] of Object.entries(tv.services)) {
      names.add(k);
      perService[k] = {
        transport: v,
        happiness: null,
        collapse: null,
        capacity: null,
      };
    }
  }
  const rows = matrix?.rows || [];
  for (const row of rows) {
    if (!row.service) continue;
    names.add(row.service);
    if (!perService[row.service]) perService[row.service] = { transport: null, happiness: null, collapse: null, capacity: null };
    perService[row.service].happiness = row;
  }
  if (Array.isArray(collapse)) {
    for (const e of collapse) {
      if (!e.service) continue;
      names.add(e.service);
      if (!perService[e.service]) perService[e.service] = { transport: null, happiness: null, collapse: null, capacity: null };
      perService[e.service].collapse = e;
    }
  }
  const recs = capacity?.recommendations || [];
  for (const r of recs) {
    if (!r.service) continue;
    names.add(r.service);
    if (!perService[r.service]) perService[r.service] = { transport: null, happiness: null, collapse: null, capacity: null };
    perService[r.service].capacity = r;
  }

  let http3Dominant = 0;
  let http2Dominant = 0;
  let ties = 0;
  for (const row of rows) {
    const w = row.winner || "";
    if (w.includes("3")) http3Dominant += 1;
    else if (w.includes("2")) http2Dominant += 1;
    else ties += 1;
  }

  const untested = coverage?.services?.["api-gateway"]?.untested_routes?.length ?? 0;
  const strictCoverage = process.env.STRICT_ENDPOINT_COVERAGE === "1";
  const quicDomPath = path.join(transportDir, "quic", "analysis", "dominance-map.json");
  const quicIntegrated = fs.existsSync(quicDomPath);
  const quicDom = quicIntegrated ? readJson(quicDomPath) : null;
  const transportRan = fs.existsSync(path.join(transportDir, "transport-validation-report.json"));
  const transportOk = !transportRan
    ? null
    : Boolean(tv && tv.all_ok === true && (down?.count || 0) === 0);
  const strictH3Ok = integrity?.http3_strict_all_ok_or_skipped !== false;
  const downgrade = integrity?.any_downgrade === true;
  const smokeOk =
    !collapseSmoke ||
    collapseSmoke.skipped === true ||
    (Number(collapseSmoke.failed || 0) === 0 && Number(collapseSmoke.p95_violations || 0) === 0);

  const global = {
    services_tested: names.size,
    http3_dominant_rows: http3Dominant,
    http2_dominant_rows: http2Dominant,
    tie_or_other_rows: ties,
    mean_superiority_score: null,
    transport_validation_all_ok:
      transportOk === null ? null : Boolean(transportOk && !downgrade && strictH3Ok),
    endpoint_coverage_untested_heuristic: untested,
    collapse_smoke_ok: smokeOk,
    production_ready: Boolean(
      (transportOk === null || transportOk) &&
        !downgrade &&
        strictH3Ok &&
        smokeOk &&
        (!strictCoverage || untested === 0),
    ),
    quic_pipeline: quicIntegrated ? "integrated" : "not_integrated",
    note: "production_ready requires cluster-generated transport report + zero heuristic untested routes; adjust gates in declare-readiness.js.",
  };

  const artifact = {
    metadata: {
      timestamp: new Date().toISOString(),
      git_commit: gitSha(repoRoot),
      transport_dir: transportDir,
      perf_dir: perfDir,
    },
    per_service: perService,
    global,
    raw_refs: {
      transport_validation_report: tv ? "transport-validation-report.json" : null,
      downgrade_detection: down ? "downgrade-detection-report.json" : null,
      protocol_integrity: integrity ? "protocol-integrity-report.json" : null,
      endpoint_coverage: coverage ? "endpoint-coverage-report.json" : null,
      collapse_smoke: collapseSmoke ? "collapse-smoke-report.json" : null,
    },
  };

  artifact.quic_pipeline = quicIntegrated ? "integrated" : "not_integrated";
  if (quicIntegrated && quicDom && typeof quicDom === "object") {
    artifact.quic = quicDom;
  }

  if (integrity && typeof integrity === "object") {
    artifact.protocol_integrity = integrity;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const summaryPath = path.join(transportDir, "global-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(artifact.global, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${summaryPath}`);
}

main();
