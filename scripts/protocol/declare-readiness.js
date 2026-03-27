#!/usr/bin/env node
/**
 * Production transport readiness gate from performance-lab JSON artifacts.
 *
 * Usage:
 *   node scripts/protocol/declare-readiness.js [--perf-dir DIR] [--max-pool N] [--panic-scan] [--strict-envelope]
 *
 * Exits 0 and prints PRODUCTION_READY=true when all gates pass; else exit 1 and lists REASON= lines.
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const out = { perfDir: "", maxPool: 200, panicScan: false, strictEnvelope: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") out.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--max-pool") out.maxPool = Number(a[++i]) || 200;
    else if (a[i] === "--panic-scan") out.panicScan = true;
    else if (a[i] === "--strict-envelope") out.strictEnvelope = true;
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
