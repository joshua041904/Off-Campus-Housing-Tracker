#!/usr/bin/env node
/**
 * Orchestrate analytics QA scripts with full bootstrap:
 * - ensure gateway reachable
 * - auto auth
 * - ensure listing exists (create if missing)
 * - run full suite
 * - print final 7-metric summary
 */

import "./bootstrap-tls.mjs";
import { bootstrapQaContext } from "./bootstrap.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..");

async function pushTelemetryToAnalytics(durationSeconds) {
  const base = (process.env.ANALYTICS_TELEMETRY_BASE_URL || "").replace(/\/$/, "");
  const tok = (process.env.ANALYTICS_TELEMETRY_TOKEN || "").trim();
  if (!base || !tok) return;
  const skewPath = join(repoRoot, "bench_logs", "coverage-kafka-skew.json");
  const body = { qa_suite_duration_seconds: durationSeconds };
  if (existsSync(skewPath)) {
    try {
      const s = JSON.parse(readFileSync(skewPath, "utf8"));
      if (typeof s.max_partition_share === "number") body.kafka_skew_max_share = s.max_partition_share;
      if (typeof s.pass === "boolean") body.kafka_skew_pass = s.pass;
    } catch {
      /* ignore */
    }
  }
  try {
    const r = await fetch(`${base}/internal/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telemetry-token": tok },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn(`[qa-suite] telemetry push HTTP ${r.status}`);
    }
  } catch (e) {
    console.warn("[qa-suite] telemetry push failed:", e?.message || e);
  }
}

function runAndCapture(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const verbose = process.env.ANALYTICS_QA_VERBOSE === "1";
  if (verbose || r.status !== 0) process.stdout.write(out);
  const marker = "__QA_JSON__";
  const jsonLine = out
    .split(/\r?\n/)
    .map((x) => x.trim())
    .reverse()
    .find((x) => x.startsWith(marker));
  const json = jsonLine ? JSON.parse(jsonLine.slice(marker.length)) : null;
  if (r.status !== 0) {
    throw new Error(`[qa-suite] ${args.at(-1)} failed with exit ${r.status ?? 1}`);
  }
  return json;
}

function printFinalSummary(m) {
  console.log("=== ANALYTICS QA RESULTS ===");
  console.log(`Entropy (variable): ${m.entropyVariable.toFixed(4)}`);
  console.log(`Entropy (deterministic): ${m.entropyDeterministic.toFixed(4)}`);
  console.log(`Avg latency: ${Math.round(m.avgLatencyMs)}ms`);
  console.log(`p95 latency: ${Math.round(m.p95LatencyMs)}ms`);
  console.log(`Hallucination rate: ${(m.hallucinationRate * 100).toFixed(1)}%`);
  console.log(`Confidence mean: ${m.confidenceMean.toFixed(1)}`);
  console.log(`Fallback rate: ${(m.fallbackRate * 100).toFixed(1)}%`);
  console.log("===========================");
}

async function main() {
  const startedAt = Date.now();
  const { baseUrl, token, listingId } = await bootstrapQaContext();

  const node = process.execPath;
  const enforce = process.env.ENFORCE_ANALYTICS_QA_THRESHOLDS ?? "";
  const qaFast = process.env.ANALYTICS_QA_FAST_MODE === "1" || process.env.ANALYTICS_QA_FAST_MODE === "true";
  const commonEnv = {
    BASE_URL: baseUrl,
    LISTING_ID: listingId,
    ANALYTICS_QA_BEARER_TOKEN: token,
    ANALYTICS_QA_SKIP_LISTING_PROBE: "1",
    ANALYTICS_QA_FAST_MODE: qaFast ? "1" : process.env.ANALYTICS_QA_FAST_MODE ?? "0",
  };

  const variabilityVariable = runAndCapture(node, [join(root, "variability-harness.mjs")], {
    ...commonEnv,
    ENFORCE_ANALYTICS_QA_THRESHOLDS: enforce,
    QA_VARIABILITY_MODE: "variable",
    EXPECT_ANALYTICS_TEMPERATURE: "",
    RUNS: process.env.RUNS ?? (qaFast ? "8" : "10"),
    VARIABILITY_CONCURRENCY: process.env.VARIABILITY_CONCURRENCY ?? "2",
  });
  const variabilityDeterministic = runAndCapture(node, [join(root, "variability-harness.mjs")], {
    ...commonEnv,
    ENFORCE_ANALYTICS_QA_THRESHOLDS: enforce,
    QA_VARIABILITY_MODE: "deterministic",
    EXPECT_ANALYTICS_TEMPERATURE: "0",
    RUNS: process.env.RUNS ?? (qaFast ? "8" : "10"),
    VARIABILITY_CONCURRENCY: process.env.VARIABILITY_CONCURRENCY ?? "2",
  });
  runAndCapture(node, [join(root, "depth-sensitivity.mjs")], commonEnv);
  runAndCapture(node, [join(root, "large-input-test.mjs")], commonEnv);
  const hallucination = runAndCapture(node, [join(root, "hallucination-test.mjs")], {
    ...commonEnv,
    ENFORCE_ANALYTICS_QA_THRESHOLDS: enforce,
  });
  const stress = runAndCapture(node, [join(root, "stress-50.mjs")], {
    ...commonEnv,
    ENFORCE_ANALYTICS_QA_THRESHOLDS: enforce,
    CONCURRENCY: process.env.CONCURRENCY ?? (qaFast ? "12" : "24"),
    STRESS_PARALLELISM: process.env.STRESS_PARALLELISM ?? "3",
  });

  const summary = {
    entropyVariable: Number(variabilityVariable?.entropy ?? NaN),
    entropyDeterministic: Number(variabilityDeterministic?.entropy ?? NaN),
    avgLatencyMs: Number(stress?.avg_latency_ms ?? NaN),
    p95LatencyMs: Number(stress?.p95_latency_ms ?? NaN),
    hallucinationRate: Number(hallucination?.hallucination_rate ?? NaN),
    confidenceMean: Number(hallucination?.confidence_mean ?? NaN),
    fallbackRate: Number(stress?.fallback_rate ?? NaN),
  };

  if (Object.values(summary).some((v) => !Number.isFinite(v))) {
    throw new Error("[qa-suite] Missing metrics in child script output (expected __QA_JSON__ lines).");
  }
  const durationSeconds = (Date.now() - startedAt) / 1000;
  const metricsPath = process.env.ANALYTICS_QA_PROM_PATH ?? "bench_logs/analytics-qa-runtime.prom";
  mkdirSync(dirname(metricsPath), { recursive: true });
  writeFileSync(
    metricsPath,
    [
      "# HELP analytics_qa_run_duration_seconds End-to-end analytics QA suite runtime in seconds.",
      "# TYPE analytics_qa_run_duration_seconds gauge",
      `analytics_qa_run_duration_seconds ${durationSeconds.toFixed(3)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  printFinalSummary(summary);
  await pushTelemetryToAnalytics(durationSeconds);
  console.log(
    `__QA_JSON__${JSON.stringify({
      script: "qa-total",
      duration_seconds: durationSeconds,
      prom_path: metricsPath,
    })}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
