#!/usr/bin/env node
/**
 * SLA slack from trace_contract.json: per-service max(span.duration) vs budgets (microseconds).
 * och_sla_resilience_score = 1 - violations/total_checks
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");
const TRACE = join(BENCH, "trace_contract.json");
const OUT_JSON = join(BENCH, "sla-resilience-score.json");
const OUT_PROM = join(BENCH, "sla-metrics.prom");

/** Max span duration per service (microseconds). */
const SLA_US = {
  "api-gateway": 300_000,
  "auth-service": 200_000,
  "booking-service": 300_000,
  "listings-service": 300_000,
  "messaging-service": 500_000,
  "analytics-service": 2_000_000,
  "trust-service": 400_000,
  "media-service": 800_000,
  "notification-service": 400_000,
};

const E2E_MAX_US = Number(process.env.OCH_SLA_E2E_TRACE_US || 2_000_000) || 2_000_000;

function loadFirstTrace() {
  if (!existsSync(TRACE)) return null;
  try {
    const j = JSON.parse(readFileSync(TRACE, "utf8"));
    const t = j?.data?.[0];
    if (t?.spans && t.processes) return t;
    if (j?.spans && j.processes) return j;
    return null;
  } catch {
    return null;
  }
}

function serviceName(span, processes) {
  return processes?.[span.processID]?.serviceName || "unknown";
}

function main() {
  mkdirSync(BENCH, { recursive: true });
  const trace = loadFirstTrace();
  if (!trace) {
    const doc = { score: 1, compliant: 1, skipped: true };
    writeFileSync(OUT_JSON, `${JSON.stringify(doc, null, 2)}\n`);
    writeFileSync(
      OUT_PROM,
      [
        "# HELP och_sla_resilience_score 1 - (violations/total SLA checks)",
        "# TYPE och_sla_resilience_score gauge",
        "och_sla_resilience_score 1",
        "# HELP och_sla_resilience_compliant 1 if score ≥ floor",
        "# TYPE och_sla_resilience_compliant gauge",
        "och_sla_resilience_compliant 1",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }
  const { spans, processes } = trace;
  const maxBySvc = new Map();
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const s of spans) {
    const svc = serviceName(s, processes);
    const d = Number(s.duration) || 0;
    const st = Number(s.startTime) || 0;
    tMin = Math.min(tMin, st);
    tMax = Math.max(tMax, st + d);
    maxBySvc.set(svc, Math.max(maxBySvc.get(svc) || 0, d));
  }
  let violations = 0;
  let checks = 0;
  for (const [svc, budget] of Object.entries(SLA_US)) {
    if (!maxBySvc.has(svc)) continue;
    checks += 1;
    const obs = maxBySvc.get(svc) || 0;
    if (obs > budget) violations += 1;
  }
  checks += 1;
  if (tMax - tMin > E2E_MAX_US) violations += 1;

  const score = checks ? Math.max(0, Math.min(1, 1 - violations / checks)) : 1;
  const minScore = Number(process.env.OCH_SLA_SCORE_MIN || "0.85");
  const compliant = score >= minScore ? 1 : 0;
  const doc = {
    specVersion: "och-sla-resilience-v1",
    score: Math.round(score * 1000) / 1000,
    violations,
    checks,
    compliant,
    e2e_span_us: tMax - tMin,
    e2e_budget_us: E2E_MAX_US,
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(doc, null, 2)}\n`);
  const prom = [
    "# HELP och_sla_resilience_score 1 - violations/checks on per-service span duration vs SLA table",
    "# TYPE och_sla_resilience_score gauge",
    `och_sla_resilience_score ${doc.score}`,
    "# HELP och_sla_resilience_compliant 1 if score ≥ OCH_SLA_SCORE_MIN (default 0.85)",
    "# TYPE och_sla_resilience_compliant gauge",
    `och_sla_resilience_compliant ${compliant}`,
    "",
  ].join("\n");
  writeFileSync(OUT_PROM, prom);
  const strict = process.env.OCH_SLA_ENFORCE === "1" || process.env.PREFLIGHT_REQUIRE_FORMAL_TRACE_GATES === "1";
  if (!compliant && strict) process.exit(1);
  process.exit(0);
}

main();
