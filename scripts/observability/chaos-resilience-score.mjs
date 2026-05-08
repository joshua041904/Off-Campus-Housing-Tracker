#!/usr/bin/env node
/**
 * Placeholder chaos score (0–100): reads optional bench_logs/chaos-resilience-input.json
 * { "scenarios": [ { "availability": 1, "trace": 1, "latency": 1, "recovery": 1 } ] }
 * else emits neutral 100 for wiring tests.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");
const INPUT = join(BENCH, "chaos-resilience-input.json");

function scenarioScore(s) {
  const av = Number(s?.availability ?? 1);
  const tr = Number(s?.trace ?? 1);
  const la = Number(s?.latency ?? 1);
  const re = Number(s?.recovery ?? 1);
  return 100 * (0.4 * av + 0.2 * tr + 0.2 * la + 0.2 * re);
}

function main() {
  mkdirSync(BENCH, { recursive: true });
  let score = 100;
  if (existsSync(INPUT)) {
    try {
      const j = JSON.parse(readFileSync(INPUT, "utf8"));
      const sc = Array.isArray(j.scenarios) ? j.scenarios : [];
      if (sc.length) {
        const parts = sc.map(scenarioScore);
        score = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10;
      }
    } catch {
      score = 0;
    }
  }
  const out = {
    specVersion: "och-chaos-resilience-v1",
    score,
    min_required: Number(process.env.OCH_CHAOS_MIN || "80"),
    compliant: score >= Number(process.env.OCH_CHAOS_MIN || "80") ? 1 : 0,
  };
  writeFileSync(join(BENCH, "chaos-resilience-score.json"), `${JSON.stringify(out, null, 2)}\n`);
  const prom = [
    "# HELP och_chaos_resilience_score Weighted chaos harness score 0-100.",
    "# TYPE och_chaos_resilience_score gauge",
    `och_chaos_resilience_score ${out.score}`,
    "# HELP och_chaos_resilience_min_required Policy floor.",
    "# TYPE och_chaos_resilience_min_required gauge",
    `och_chaos_resilience_min_required ${out.min_required}`,
    "# HELP och_chaos_resilience_compliant 1 if score ≥ min_required.",
    "# TYPE och_chaos_resilience_compliant gauge",
    `och_chaos_resilience_compliant ${out.compliant}`,
    "",
  ].join("\n");
  writeFileSync(join(BENCH, "chaos-metrics.prom"), prom);
  console.error(`chaos-resilience-score: score=${score} wrote bench_logs/chaos-metrics.prom`);
}

main();
