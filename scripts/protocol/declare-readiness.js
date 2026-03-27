#!/usr/bin/env node
/**
 * Production transport readiness gate from performance-lab JSON artifacts.
 *
 * Usage:
 *   node scripts/protocol/declare-readiness.js [--perf-dir DIR] [--max-pool N] [--panic-scan] [--strict-envelope]
 *   [--strict-quic] [--strict-quic-min-score N]  With --transport-artifact: require QUIC dominance-map integration (and optional score floor)
 *   [--transport-artifact PATH]  Optional: bench_logs/transport-lab/final-transport-artifact.json (cluster transport lab)
 *
 * With --transport-artifact: fails if protocol_integrity.any_http2_collapse_anomaly === true (matrix http2 p95 > 3× http1),
 * or the same flag is true in perf-dir protocol-matrix-anomalies.json (from extract-protocol-matrix.js) when the artifact omits protocol_integrity.
 *
 * Exits 0 and prints PRODUCTION_READY=true when all gates pass; else exit 1 and lists REASON= lines.
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const out = {
    perfDir: "",
    maxPool: 200,
    panicScan: false,
    strictEnvelope: false,
    transportArtifact: "",
    strictQuic: false,
    strictQuicMinScore: 0.6,
  };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") out.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--max-pool") out.maxPool = Number(a[++i]) || 200;
    else if (a[i] === "--panic-scan") out.panicScan = true;
    else if (a[i] === "--strict-envelope") out.strictEnvelope = true;
    else if (a[i] === "--strict-quic") out.strictQuic = true;
    else if (a[i] === "--strict-quic-min-score") out.strictQuicMinScore = Number(a[++i]) || 0.6;
    else if (a[i] === "--transport-artifact") out.transportArtifact = path.resolve(a[++i] || "");
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function matrixRows(matrix) {
  if (Array.isArray(matrix.rows)) return matrix.rows;
  if (Array.isArray(matrix.services)) return matrix.services;
  return [];
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const failures = [];
  if (args.strictQuic && !args.transportArtifact) {
    failures.push("declare-readiness: --strict-quic requires --transport-artifact");
  }

  const matrixPath = path.join(perfDir, "protocol-happiness-matrix.json");
  const supPath = path.join(perfDir, "protocol-superiority-scores.json");
  const collapsePath = path.join(perfDir, "collapse-summary.json");

  if (!fs.existsSync(matrixPath)) failures.push(`missing ${matrixPath}`);
  if (!fs.existsSync(supPath)) failures.push(`missing ${supPath}`);
  if (!fs.existsSync(collapsePath)) failures.push(`missing ${collapsePath}`);
  if (failures.length) {
    console.log("PRODUCTION_READY=false");
    failures.forEach((f) => console.log(`REASON=${f}`));
    process.exit(1);
  }

  const matrix = readJson(matrixPath);
  const superiority = readJson(supPath);
  const collapseArr = readJson(collapsePath);
  const collapseByService = new Map(
    (Array.isArray(collapseArr) ? collapseArr : []).map((e) => [e.service, e]),
  );

  const rows = matrixRows(matrix);
  const supServices = superiority.services || [];

  /** Gate 1–2: utilization + dominance + envelope (matrix rows) */
  for (const row of rows) {
    const name = row.service;
    const d = row.transport_dominance || {};
    const tau =
      row.transport_gain_tau != null ? row.transport_gain_tau : d.transport_gain_tau_h3_vs_h2;
    const h3Un =
      row.h3_transport_unlocked != null ? row.h3_transport_unlocked : d.h3_transport_unlocked;
    const poolTh =
      row.pool_threshold_for_h3 != null
        ? row.pool_threshold_for_h3
        : d.pool_threshold_for_h3_advantage;
    const poolCeil =
      row.pool_threshold_ceil != null ? row.pool_threshold_ceil : d.pool_threshold_ceil;
    const recPool = row.recommended_pool;
    const util = row.winner_utilization_pool_10;
    const safe = row.safe_rps_predicted_pool_10_winner;
    const collapseMax = row.collapse_max_rps_pre_collapse;
    const winner = row.winner || row.winner_protocol;
    let winnerCollapseRps = null;
    const csum = collapseByService.get(name);
    if (csum && csum.protocols && winner && csum.protocols[winner]) {
      winnerCollapseRps = Number(csum.protocols[winner].max_rps_pre_collapse);
    }

    if (util != null && Number.isFinite(util)) {
      if (util >= 1.0) failures.push(`${name}: winner_utilization_pool_10>=1.0 (backend-saturated)`);
      else if (util >= 0.85)
        failures.push(`${name}: winner_utilization_pool_10>=0.85 (envelope unstable for fair transport compare)`);
    }

    if (tau != null && Number.isFinite(tau)) {
      if (tau <= 0 && h3Un === true) failures.push(`${name}: h3_transport_unlocked true but tau<=0`);
      const ceilTh = poolCeil != null ? poolCeil : poolTh != null ? Math.ceil(poolTh) : null;
      if (tau > 0 && ceilTh != null && recPool != null && recPool >= ceilTh && h3Un !== true) {
        failures.push(`${name}: tau>0 and recommended_pool>=ceil(threshold) but h3_transport_unlocked false`);
      }
    }

    if (args.strictEnvelope) {
      const collapseRef =
        winnerCollapseRps != null && Number.isFinite(winnerCollapseRps) ? winnerCollapseRps : collapseMax;
      if (
        safe != null &&
        collapseRef != null &&
        Number.isFinite(safe) &&
        Number.isFinite(collapseRef) &&
        safe >= collapseRef
      ) {
        failures.push(
          `${name}: predicted_safe_rps_pool10_winner (${safe}) >= collapse RPS (${collapseRef}) — enable only if you treat both as comparable`,
        );
      }
    }

    if (recPool != null && recPool > args.maxPool) {
      failures.push(`${name}: recommended_pool ${recPool} exceeds --max-pool ${args.maxPool}`);
    }

  }

  /** Gate 3–4: fail rate + tail penalty median (superiority) */
  const allPenalties = [];
  for (const svc of supServices) {
    const supWinner = svc.winner_protocol;
    let winnerEntry = null;
    for (const p of svc.protocols || []) {
      const c = p.scores?.composite ?? 0;
      if (
        !winnerEntry ||
        c > (winnerEntry.scores?.composite ?? 0) ||
        (c === (winnerEntry.scores?.composite ?? 0) && p.p95_ms < winnerEntry.p95_ms)
      ) {
        winnerEntry = p;
      }
    }
    for (const p of svc.protocols || []) {
      if (p.tail_penalty != null && Number.isFinite(p.tail_penalty)) allPenalties.push(p.tail_penalty);
      const fr = Number(p.fail_rate) || 0;
      if (fr >= 0.02) failures.push(`${svc.service}/${p.protocol}: fail_rate>=2%`);
      const comp = p.scores?.composite ?? 0;
      const stab = p.scores?.stability;
      if (fr >= 0.02 && comp > 0.7) failures.push(`${svc.service}/${p.protocol}: high composite despite fail_rate>=2%`);
      if (p.protocol === supWinner && stab !== 1) {
        failures.push(`${svc.service}: winner ${supWinner} has StabilityScore!=1`);
      }
    }
    /** Winner must match argmax composite (tie-break p95) */
    if (winnerEntry && supWinner && winnerEntry.protocol !== supWinner) {
      failures.push(
        `${svc.service}: declared winner_protocol ${supWinner} != composite winner ${winnerEntry.protocol}`,
      );
    }
  }

  const median =
    allPenalties.length === 0
      ? 0
      : [...allPenalties].sort((a, b) => a - b)[Math.floor(allPenalties.length / 2)];
  const threshold = median * 4 || 1e-9;
  for (const svc of supServices) {
    for (const p of svc.protocols || []) {
      const pen = p.tail_penalty;
      if (pen == null || !Number.isFinite(pen)) continue;
      if (pen > threshold && threshold > 0) {
        failures.push(
          `${svc.service}/${p.protocol}: tail_penalty ${pen.toFixed(4)} > 4x median (${threshold.toFixed(4)})`,
        );
      }
    }
  }

  /** Optional: k6 / matrix logs — word "panic" (enable with --panic-scan) */
  if (args.transportArtifact) {
    const tap = args.transportArtifact;
    if (!fs.existsSync(tap)) {
      failures.push(`missing transport artifact ${tap}`);
    } else {
      let art;
      try {
        art = readJson(tap);
      } catch {
        failures.push(`invalid JSON transport artifact ${tap}`);
        art = null;
      }
      if (art) {
        const g = art.global || {};
        /** Transport gates: HTTP/2 matrix collapse → QUIC integration → QUIC dominance (strict) — order matters. */
        const pint = art.protocol_integrity;
        const anomaliesPath = path.join(perfDir, "protocol-matrix-anomalies.json");
        let http2MatrixCollapse =
          pint && pint.any_http2_collapse_anomaly === true;
        if (!http2MatrixCollapse && fs.existsSync(anomaliesPath)) {
          try {
            const ax = readJson(anomaliesPath);
            if (ax.any_http2_collapse_anomaly === true) http2MatrixCollapse = true;
          } catch {
            /* ignore malformed anomalies file */
          }
        }
        if (http2MatrixCollapse) {
          failures.push("HTTP/2 collapse anomaly detected (protocol matrix: http2 p95 > 3× http1 p95)");
        }
        if (args.strictQuic) {
          const qp = art.quic_pipeline ?? g.quic_pipeline;
          if (qp !== "integrated") failures.push("QUIC pipeline not integrated (--strict-quic)");
          const envMin = process.env.STRICT_QUIC_MIN_SCORE;
          const minScore =
            envMin != null && envMin !== "" && !Number.isNaN(Number(envMin))
              ? Number(envMin)
              : args.strictQuicMinScore;
          const ms = art.quic?.mean_dominance_score;
          if (ms != null && Number.isFinite(ms) && Number.isFinite(minScore) && ms < minScore) {
            failures.push(
              `QUIC mean_dominance_score ${ms} < ${minScore} (--strict-quic / STRICT_QUIC_MIN_SCORE)`,
            );
          }
        }
        if (g.transport_validation_all_ok === false) {
          failures.push("transport artifact: transport_validation_all_ok is false");
        }
        if (g.endpoint_coverage_untested_heuristic > 0 && process.env.STRICT_ENDPOINT_COVERAGE === "1") {
          failures.push(
            `transport artifact: endpoint_coverage_untested_heuristic=${g.endpoint_coverage_untested_heuristic} (STRICT_ENDPOINT_COVERAGE=1)`,
          );
        }
        if (g.collapse_smoke_ok === false) {
          failures.push("transport artifact: collapse_smoke_ok is false");
        }
        if (g.production_ready === false) {
          failures.push("transport artifact: global.production_ready is false");
        }
        const ps = art.per_service || {};
        for (const [svc, row] of Object.entries(ps)) {
          const t = row.transport;
          if (t && t.downgrade_detected) {
            failures.push(`${svc}: transport.downgrade_detected in artifact`);
          }
          if (t && t.overall_ok === false) {
            failures.push(`${svc}: transport.overall_ok false in artifact`);
          }
        }
      }
    }
  }

  if (args.panicScan) {
    const bench = path.join(repoRoot, "bench_logs");
    const panicHits = [];
    let logsSeen = 0;
    const maxLogs = 80;
    function walkScan(d, depth) {
      if (depth > 24 || !fs.existsSync(d) || logsSeen >= maxLogs) return;
      let ents;
      try {
        ents = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of ents) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walkScan(p, depth + 1);
        else if (ent.isFile() && ent.name.endsWith(".log") && /matrix|k6/i.test(p)) {
          if (logsSeen >= maxLogs) return;
          logsSeen += 1;
          try {
            const t = fs.readFileSync(p, "utf8").slice(0, 400000);
            if (/\bpanic\b/i.test(t)) panicHits.push(p);
          } catch {
            /* ignore */
          }
        }
      }
    }
    walkScan(bench, 0);
    if (panicHits.length) {
      failures.push(
        `k6/matrix logs: panic mentioned in ${panicHits.slice(0, 3).join("; ")}${panicHits.length > 3 ? "…" : ""}`,
      );
    }
  }

  if (failures.length === 0) {
    console.log("PRODUCTION_READY=true");
    process.exit(0);
  }
  console.log("PRODUCTION_READY=false");
  failures.forEach((f) => console.log(`REASON=${f}`));
  process.exit(1);
}

main();
