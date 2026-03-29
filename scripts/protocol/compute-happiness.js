#!/usr/bin/env node
/**
 * Tail-weighted protocol superiority scores, happiness matrix, and HTTP/3 vs HTTP/2
 * dominance thresholds from ceiling service-model + collapse-summary (+ optional capacity JSON).
 *
 * Usage:
 *   node scripts/protocol/compute-happiness.js \
 *     --service-model bench_logs/ceiling/<stamp>/service-model.json \
 *     --collapse bench_logs/performance-lab/collapse-summary.json \
 *     --out-dir bench_logs/performance-lab
 *
 * Optional: capacity-recommendations.json in out-dir is read automatically if present.
 */
const fs = require("fs");
const path = require("path");

const WEIGHTS = {
  throughput: 0.35,
  latency: 0.2,
  tailRisk: 0.25,
  stability: 0.2,
};

const PROTOCOLS = ["http1", "http2", "http3"];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    serviceModel: "",
    collapse: "",
    outDir: "",
    capacity: "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--service-model") out.serviceModel = args[++i] || "";
    else if (a === "--collapse") out.collapse = args[++i] || "";
    else if (a === "--out-dir") out.outDir = args[++i] || "";
    else if (a === "--capacity") out.capacity = args[++i] || "";
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** One row per protocol (highest RPS if duplicates). */
function mergeProtocols(protocols) {
  const by = new Map();
  for (const p of protocols || []) {
    const key = p.protocol;
    if (!key) continue;
    const prev = by.get(key);
    const rps = Number(p.rps) || 0;
    if (!prev || rps > (Number(prev.rps) || 0)) by.set(key, p);
  }
  return by;
}

function stabilityScore(failRate) {
  const f = Number(failRate) || 0;
  if (f > 0.02) return 0;
  if (f > 0) return 0.5;
  return 1;
}

function tailPenalty(p) {
  const tr = Number(p.tail_ratio_p95_over_p50);
  const mr = Number(p.max_ratio_over_p95);
  const fr = Number(p.fail_rate) || 0;
  const trN = Number.isFinite(tr) ? tr : 0;
  const mrN = Number.isFinite(mr) ? mr : 0;
  return trN * 0.4 + mrN * 0.3 + fr * 100 * 0.3;
}

function scoreService(serviceBlock, collapseByService, poolByService) {
  const service = serviceBlock.service;
  const byProto = mergeProtocols(serviceBlock.protocols);
  const rows = PROTOCOLS.map((k) => {
    const p = byProto.get(k);
    return p ? { key: k, ...p } : { key: k, rps: 0, p95_ms: 0, p50_ms: 0, fail_rate: 1 };
  });

  const maxRps = Math.max(...rows.map((r) => Number(r.rps) || 0), 1e-9);
  const p95s = rows.map((r) => Math.max(Number(r.p95_ms) || 0, 1e-6));
  const minP95 = Math.min(...p95s.filter((x) => x > 1e-5));
  const safeMinP95 = minP95 > 0 && Number.isFinite(minP95) ? minP95 : 1e-6;

  const penalties = rows.map((r) => tailPenalty(r));
  const worstPen = Math.max(...penalties, 1e-9);

  const scored = rows.map((r) => {
    const rps = Number(r.rps) || 0;
    const p95 = Math.max(Number(r.p95_ms) || 0, 1e-6);
    const throughputScore = maxRps > 0 ? Math.min(1, rps / maxRps) : 0;
    const latencyScore = Math.min(1, safeMinP95 / p95);
    const pen = tailPenalty(r);
    const tailRiskScore = 1 - pen / worstPen;
    const stab = stabilityScore(r.fail_rate);
    const composite =
      throughputScore * WEIGHTS.throughput +
      latencyScore * WEIGHTS.latency +
      tailRiskScore * WEIGHTS.tailRisk +
      stab * WEIGHTS.stability;

    return {
      protocol: r.key,
      rps,
      p50_ms: Number(r.p50_ms) || 0,
      p95_ms: Number(r.p95_ms) || 0,
      max_ms: Number(r.max_ms) || 0,
      fail_rate: Number(r.fail_rate) || 0,
      tail_penalty: Number(pen.toFixed(6)),
      mu_estimated_rps_per_slot: r.mu_estimated_rps_per_slot != null ? Number(r.mu_estimated_rps_per_slot) : null,
      utilization_pool_10: r.utilization_by_pool && r.utilization_by_pool["10"] != null
        ? Number(r.utilization_by_pool["10"])
        : null,
      predicted_safe_rps_pool_10:
        r.predicted_safe_rps_by_pool && r.predicted_safe_rps_by_pool["10"] != null
          ? Number(r.predicted_safe_rps_by_pool["10"])
          : null,
      scores: {
        throughput: Number(throughputScore.toFixed(4)),
        latency: Number(latencyScore.toFixed(4)),
        tail_risk: Number(tailRiskScore.toFixed(4)),
        stability: stab,
        composite: Number(composite.toFixed(4)),
      },
    };
  });

  let winner = scored[0];
  for (const s of scored) {
    if (s.scores.composite > winner.scores.composite) winner = s;
    else if (s.scores.composite === winner.scores.composite && s.p95_ms < winner.p95_ms) winner = s;
  }

  const collapse = collapseByService.get(service);
  let collapseRps = 0;
  if (collapse && collapse.protocols) {
    for (const pr of Object.values(collapse.protocols)) {
      const v = Number(pr.max_rps_pre_collapse) || 0;
      if (v > collapseRps) collapseRps = v;
    }
  }

  const recPool = poolByService.get(service) ?? 10;
  const util10 = winner.utilization_pool_10;
  const envelopeStable =
    util10 == null || Number.isNaN(util10) ? null : util10 < 0.85;

  const h2 = byProto.get("http2");
  const h3 = byProto.get("http3");
  const lambda2 = h2 ? Number(h2.rps) || 0 : 0;
  const lambda3 = h3 ? Number(h3.rps) || 0 : 0;
  const mu3 = h3 && h3.mu_estimated_rps_per_slot != null ? Number(h3.mu_estimated_rps_per_slot) : null;
  const tau = lambda2 > 0 ? lambda3 / lambda2 - 1 : null;
  /** Ignore noise: JSON may round τ to 0 while float τ>0 — unlock only if materially faster H3 */
  const tauSignificant = lambda2 > 0 && lambda3 > lambda2 * 1.0001;
  let poolThresholdH3 = null;
  if (mu3 != null && mu3 > 0 && lambda3 > 0) {
    poolThresholdH3 = lambda3 / mu3;
  } else if (mu3 != null && mu3 > 0 && lambda2 > 0 && tau != null) {
    poolThresholdH3 = (lambda2 * (1 + tau)) / mu3;
  }
  const poolThresholdCeil =
    poolThresholdH3 != null && Number.isFinite(poolThresholdH3) ? Math.ceil(poolThresholdH3) : null;

  const T = lambda2 > 0 ? lambda3 / lambda2 : null;
  const B = mu3 != null && Number.isFinite(mu3) ? mu3 * recPool : null;
  const dominanceRuleHolds = B != null && T != null && lambda2 > 0 ? B > lambda2 * T : null;

  const h3Unlocked =
    poolThresholdCeil != null && tauSignificant && recPool >= poolThresholdCeil;

  return {
    service,
    model_best_protocol: serviceBlock.best_protocol,
    protocols: scored,
    winner_protocol: winner.protocol,
    winner_composite: winner.scores.composite,
    winner_utilization_pool_10: util10,
    envelope_stable_at_pool_10: envelopeStable,
    safe_rps_predicted_pool_10_winner: winner.predicted_safe_rps_pool_10,
    collapse_max_rps_pre_collapse: collapseRps || null,
    recommended_pool: recPool,
    transport_dominance: {
      lambda_http2_rps: lambda2 || null,
      lambda_http3_rps: lambda3 || null,
      transport_gain_tau_h3_vs_h2: tau != null && Number.isFinite(tau) ? Number(tau.toFixed(4)) : null,
      mu_used_http3: mu3,
      pool_threshold_for_h3_advantage: poolThresholdH3 != null ? Number(poolThresholdH3.toFixed(4)) : null,
      pool_threshold_ceil: poolThresholdCeil,
      backend_capacity_B_mu_times_pool:
        B != null && Number.isFinite(B) ? Number(B.toFixed(4)) : null,
      transport_ratio_T_lambda3_over_lambda2: T != null && Number.isFinite(T) ? Number(T.toFixed(4)) : null,
      dominance_rule_B_gt_lambda2_times_T: dominanceRuleHolds,
      h3_transport_unlocked: h3Unlocked,
      note: !tauSignificant
        ? "HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority."
        : null,
    },
  };
}

function loadCapacityByService(capacityPath) {
  const map = new Map();
  if (!capacityPath || !fs.existsSync(capacityPath)) return map;
  try {
    const j = readJson(capacityPath);
    const recs = j.recommendations || [];
    for (const r of recs) {
      if (r.service && r.recommended_pool != null) map.set(r.service, Number(r.recommended_pool));
    }
  } catch {
    /* ignore */
  }
  return map;
}

function buildCollapseMap(collapseArr) {
  const m = new Map();
  for (const e of collapseArr || []) {
    if (e.service) m.set(e.service, e);
  }
  return m;
}

function writeMarkdown(matrix, superiority, outPath) {
  const lines = [];
  lines.push("# Protocol ranking (tail-weighted)");
  lines.push("");
  lines.push("Composite score weights: throughput 0.35, latency 0.20, tail risk 0.25, stability 0.20.");
  lines.push("");
  for (const row of matrix) {
    lines.push(`## ${row.service}`);
    lines.push("");
    lines.push("| Protocol | Composite | RPS | p95 ms | fail rate |");
    lines.push("|----------|----------:|----:|-------:|----------:|");
    const byP = new Map(row.protocols.map((p) => [p.protocol, p]));
    for (const k of PROTOCOLS) {
      const p = byP.get(k);
      if (!p) continue;
      lines.push(
        `| ${k} | ${p.scores.composite} | ${Number(p.rps).toFixed(2)} | ${Number(p.p95_ms).toFixed(2)} | ${(Number(p.fail_rate) * 100).toFixed(2)}% |`,
      );
    }
    lines.push("");
    lines.push(`- **Winner (score):** ${row.winner_protocol} (composite ${row.winner_composite})`);
    lines.push(`- **Model best_protocol:** ${row.model_best_protocol}`);
    lines.push(
      `- **Envelope stable (utilization pool=10 < 0.85):** ${row.envelope_stable_at_pool_10 === null ? "n/a" : row.envelope_stable_at_pool_10}`,
    );
    lines.push(
      `- **Predicted safe RPS @ pool=10 (winner row):** ${row.safe_rps_predicted_pool_10_winner == null ? "n/a" : row.safe_rps_predicted_pool_10_winner.toFixed(2)}`,
    );
    lines.push(
      `- **Max pre-collapse RPS (any protocol, collapse summary):** ${row.collapse_max_rps_pre_collapse == null ? "n/a" : row.collapse_max_rps_pre_collapse.toFixed(2)}`,
    );
    lines.push(`- **Recommended pool (capacity file or default 10):** ${row.recommended_pool}`);
    const d = row.transport_dominance;
    if (d) {
      lines.push(`- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** ${d.transport_gain_tau_h3_vs_h2 ?? "n/a"}`);
      lines.push(
        `- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** ${d.pool_threshold_ceil ?? "n/a"}`,
      );
      lines.push(
        `- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** ${d.h3_transport_unlocked ?? "n/a"}`,
      );
      lines.push(
        `- **Rule B > λ2×T (backend capacity vs transport-scaled load):** ${d.dominance_rule_B_gt_lambda2_times_T ?? "n/a"}`,
      );
      if (d.note) lines.push(`- **Note:** ${d.note}`);
    }
    lines.push("");
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const outDir = args.outDir ? path.resolve(args.outDir) : path.join(repoRoot, "bench_logs", "performance-lab");
  if (!args.serviceModel || !fs.existsSync(args.serviceModel)) {
    console.error("Missing or invalid --service-model");
    process.exit(1);
  }
  const collapsePath =
    args.collapse && fs.existsSync(args.collapse)
      ? args.collapse
      : path.join(outDir, "collapse-summary.json");
  if (!fs.existsSync(collapsePath)) {
    console.error(`Missing collapse summary: ${collapsePath}`);
    process.exit(1);
  }

  const capacityPath =
    args.capacity && fs.existsSync(args.capacity)
      ? args.capacity
      : path.join(outDir, "capacity-recommendations.json");
  const poolByService = loadCapacityByService(fs.existsSync(capacityPath) ? capacityPath : "");

  const model = readJson(args.serviceModel);
  const collapseArr = readJson(collapsePath);
  const collapseByService = buildCollapseMap(Array.isArray(collapseArr) ? collapseArr : []);

  const services = model.services || [];
  const matrix = [];
  const superiority = { generated_at: new Date().toISOString(), source_service_model: args.serviceModel, services: [] };

  for (const block of services) {
    const row = scoreService(block, collapseByService, poolByService);
    matrix.push(row);
    superiority.services.push({
      service: row.service,
      winner_protocol: row.winner_protocol,
      model_best_protocol: row.model_best_protocol,
      winner_utilization_pool_10: row.winner_utilization_pool_10,
      protocols: row.protocols.map((p) => ({
        protocol: p.protocol,
        scores: p.scores,
        rps: p.rps,
        p95_ms: p.p95_ms,
        fail_rate: p.fail_rate,
        tail_penalty: p.tail_penalty,
      })),
      transport_dominance: row.transport_dominance,
    });
  }

  const happinessMatrix = {
    generated_at: new Date().toISOString(),
    weights: WEIGHTS,
    source_service_model: args.serviceModel,
    source_collapse: collapsePath,
    source_capacity: fs.existsSync(capacityPath) ? capacityPath : null,
    rows: matrix.map((row) => {
      const d = row.transport_dominance;
      return {
        service: row.service,
        http1_score: row.protocols.find((p) => p.protocol === "http1")?.scores.composite ?? null,
        http2_score: row.protocols.find((p) => p.protocol === "http2")?.scores.composite ?? null,
        http3_score: row.protocols.find((p) => p.protocol === "http3")?.scores.composite ?? null,
        winner: row.winner_protocol,
        winner_utilization_pool_10: row.winner_utilization_pool_10,
        envelope_stable_at_pool_10: row.envelope_stable_at_pool_10,
        safe_rps_predicted_pool_10_winner: row.safe_rps_predicted_pool_10_winner,
        collapse_max_rps_pre_collapse: row.collapse_max_rps_pre_collapse,
        recommended_pool: row.recommended_pool,
        transport_gain_tau: d?.transport_gain_tau_h3_vs_h2 ?? null,
        pool_threshold_for_h3: d?.pool_threshold_for_h3_advantage ?? null,
        pool_threshold_ceil: d?.pool_threshold_ceil ?? null,
        h3_transport_unlocked: d?.h3_transport_unlocked ?? null,
        transport_dominance: row.transport_dominance,
      };
    }),
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outMatrix = path.join(outDir, "protocol-happiness-matrix.json");
  const outSuperiority = path.join(outDir, "protocol-superiority-scores.json");
  const outMd = path.join(outDir, "protocol-ranking.md");

  fs.writeFileSync(outMatrix, `${JSON.stringify(happinessMatrix, null, 2)}\n`, "utf8");
  fs.writeFileSync(outSuperiority, `${JSON.stringify(superiority, null, 2)}\n`, "utf8");
  writeMarkdown(matrix, superiority, outMd);

  console.log(`Wrote ${outMatrix}`);
  console.log(`Wrote ${outSuperiority}`);
  console.log(`Wrote ${outMd}`);
}

main();
