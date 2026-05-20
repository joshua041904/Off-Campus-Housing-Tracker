#!/usr/bin/env node
/**
 * Query Prometheus for metrics referenced in OCH Grafana dashboards (ConfigMaps).
 * Fails when required panel metrics are absent and no diagnostic fallback exists.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OBS = join(ROOT, "infra/k8s/base/observability");

const PROM_BASE = (
  process.env.PROMETHEUS_URL ||
  process.env.PROM_URL ||
  process.env.PROMETHEUS_BASE_URL ||
  "http://127.0.0.1:19090/prometheus"
).replace(/\/$/, "");
const PROM_URL = PROM_BASE.endsWith("/prometheus") ? PROM_BASE : `${PROM_BASE}/prometheus`;

/** Required metric names that must exist (substring match on __name__). */
const REQUIRED_METRICS = [
  "app_runtime_critical_path_ms",
  "app_runtime_latency_ms",
  "och_bootstrap_wall_clock_seconds",
  "och_preflight_lab_wall_clock_seconds",
  "och_coverage_phase_vi2_verify_wall_clock_seconds",
  "och_trace_smoke_span_count",
  "och_outbox_supported",
  "och_outbox_unpublished_count",
  "och_gateway_protocol_smoke_success",
  "och_quic_forensic_valid",
  "och_quic_frame_count",
  "http_requests_total",
  "trace_service_latency_ms_bucket",
];

/** Must have a Prometheus sample newer than this many seconds (Pushgateway + scrapes). */
const METRIC_MAX_AGE_SEC = Number(process.env.OCH_PROM_METRIC_MAX_AGE_SEC || "7200");

const FRESHNESS_REQUIRED = [
  "och_trace_smoke_span_count",
  "och_gateway_protocol_smoke_success",
  "och_quic_forensic_valid",
  "och_outbox_supported",
];

/** Metrics with diagnostic fallback — warn only. */
const OPTIONAL_METRICS = [
  "analytics_latency_seconds_bucket",
  "http_request_duration_seconds_bucket",
  "ai_health_composite_score",
  "analytics_entropy_value",
  "analytics_generation_entropy_bucket",
  "kafka_skew_max_share",
  "qa_suite_duration_seconds",
];

function collectDashboardFiles() {
  const files = [];
  for (const name of readdirSync(OBS)) {
    if (!/grafana-dashboard.*\.(yaml|json)$/.test(name) && name !== "grafana-dashboards.yaml") continue;
    files.push(join(OBS, name));
  }
  files.push(join(OBS, "grafana-dashboard-bootstrap-runtime.json"));
  return files;
}

function extractExprs(text) {
  const exprs = [];
  const re = /"expr"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    exprs.push(m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"));
  }
  return exprs;
}

function metricNamesFromExpr(expr) {
  const names = new Set();
  const re = /\b([a-zA-Z_:][a-zA-Z0-9_:]*)\s*[\[{]/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    const n = m[1];
    if (!n.startsWith("sum") && !n.startsWith("rate") && !n.startsWith("histogram") && !n.startsWith("label")) {
      names.add(n.split("_bucket")[0].replace(/_count$/, "").replace(/_sum$/, ""));
    }
  }
  const bare = /\b([a-z][a-z0-9_]*)\b/g;
  while ((m = bare.exec(expr)) !== null) {
    const n = m[1];
    if (
      n.includes("_") &&
      !["sum", "rate", "by", "on", "or", "and", "unless", "avg", "max", "min", "topk", "clamp", "vector", "bool"].includes(
        n,
      )
    ) {
      names.add(n);
    }
  }
  return [...names];
}

async function promQuery(query) {
  const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const tls = process.env.PROMETHEUS_TLS_INSECURE === "1" ? { rejectUnauthorized: false } : {};
  const res = await fetch(url, tls);
  if (!res.ok) throw new Error(`Prometheus ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.status !== "success") throw new Error(JSON.stringify(body));
  return body.data?.result ?? [];
}

async function metricExists(name) {
  const results = await promQuery(`count({__name__=~"${name}.*"})`);
  return results.some((r) => Number(r.value?.[1]) > 0);
}

async function metricMaxAgeOk(name) {
  const q = `(time() - timestamp(max(${name}))) < bool ${METRIC_MAX_AGE_SEC}`;
  const r = await promQuery(q);
  return r.some((x) => String(x.value?.[1]) === "1");
}

async function main() {
  const allExprs = [];
  for (const f of collectDashboardFiles()) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const e of extractExprs(text)) allExprs.push({ file: f, expr: e });
  }

  console.log(`Prometheus: ${PROM_URL}`);
  console.log(`Dashboard expr count: ${allExprs.length}`);

  const missingRequired = [];
  for (const m of REQUIRED_METRICS) {
    const ok = await metricExists(m);
    console.log(`${ok ? "OK" : "MISSING"} required metric: ${m}`);
    if (!ok) missingRequired.push(m);
  }

  const missingOptional = [];
  for (const m of OPTIONAL_METRICS) {
    const ok = await metricExists(m);
    console.log(`${ok ? "OK" : "warn"} optional metric: ${m}`);
    if (!ok) missingOptional.push(m);
  }

  const deadExprs = [];
  for (const { file, expr } of allExprs) {
    if (/diagnostic|och_bootstrap_run_info|vector\(0\)/.test(expr)) continue;
    try {
      const r = await promQuery(expr);
      if (r.length === 0) deadExprs.push({ file, expr });
    } catch (e) {
      deadExprs.push({ file, expr, error: String(e?.message || e) });
    }
  }

  if (deadExprs.length) {
    console.log("\n=== Panels with empty instant query (may be OK for rate queries without traffic) ===");
    for (const d of deadExprs.slice(0, 40)) {
      console.log(`\n${d.file}\n  expr: ${d.expr.slice(0, 120)}${d.expr.length > 120 ? "…" : ""}`);
      if (d.error) console.log(`  error: ${d.error}`);
    }
    if (deadExprs.length > 40) console.log(`… and ${deadExprs.length - 40} more`);
  }

  if (missingRequired.length) {
    console.error("\nFAILED: missing required metrics:", missingRequired.join(", "));
    console.error("Hint: run cold-bootstrap / verify-app-runtime / obs-smoke-trace.sh to push Pushgateway metrics.");
    process.exit(1);
  }

  const staleFresh = [];
  for (const m of FRESHNESS_REQUIRED) {
    const ok = await metricExists(m);
    if (!ok) continue;
    const fresh = await metricMaxAgeOk(m);
    console.log(`${fresh ? "OK" : "STALE"} freshness (<${METRIC_MAX_AGE_SEC}s): ${m}`);
    if (!fresh) staleFresh.push(m);
  }

  if (staleFresh.length) {
    console.error("\nFAILED: required metrics exist but samples are older than", METRIC_MAX_AGE_SEC, "s:", staleFresh.join(", "));
    console.error("Hint: run obs-smoke-trace.sh, obs-smoke-gateway-protocols.sh, transport-quic-v6-v7-prove, deploys scraping /metrics.");
    process.exit(1);
  }

  console.log("\nobs-verify-dashboards: required metrics present.");
  if (missingOptional.length) {
    console.log("Optional gaps (dashboard diagnostic rows should explain):", missingOptional.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
