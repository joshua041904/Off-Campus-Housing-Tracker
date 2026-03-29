#!/usr/bin/env node
/**
 * Flat envelope view for dashboards / Plotly / D3 from protocol-happiness-matrix.json.
 *
 *   node scripts/protocol/build-envelope-dashboard.js [--perf-dir DIR]
 */
const fs = require("fs");
const path = require("path");

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  let perfDir = path.join(repoRoot, "bench_logs", "performance-lab");
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") perfDir = path.resolve(a[++i] || "");
  }
  const matrixPath = path.join(perfDir, "protocol-happiness-matrix.json");
  if (!fs.existsSync(matrixPath)) {
    console.error(`Missing ${matrixPath}`);
    process.exit(1);
  }
  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  const rows = Array.isArray(matrix.rows) ? matrix.rows : matrix.services || [];
  const dashboard = rows.map((row) => {
    const d = row.transport_dominance || {};
    return {
      service: row.service,
      collapse_max_rps_pre_collapse: row.collapse_max_rps_pre_collapse,
      safe_rps_pool10_winner: row.safe_rps_predicted_pool_10_winner,
      recommended_pool: row.recommended_pool,
      pool_threshold_for_h3: row.pool_threshold_for_h3 ?? d.pool_threshold_for_h3_advantage,
      pool_threshold_ceil: row.pool_threshold_ceil ?? d.pool_threshold_ceil,
      transport_gain_tau: row.transport_gain_tau ?? d.transport_gain_tau_h3_vs_h2,
      h3_transport_unlocked: row.h3_transport_unlocked ?? d.h3_transport_unlocked,
      winner_utilization_pool_10: row.winner_utilization_pool_10,
      winner_protocol: row.winner,
    };
  });
  const out = path.join(perfDir, "envelope-dashboard.json");
  fs.writeFileSync(
    out,
    `${JSON.stringify({ generated_at: new Date().toISOString(), services: dashboard }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote ${out}`);
}

main();
