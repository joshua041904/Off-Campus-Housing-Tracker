#!/usr/bin/env node
/**
 * Trace contract: required Jaeger services (dynamic from services/*-service + api-gateway), depth, net.proto, budgets.
 *
 * Usage:
 *   node scripts/validate-trace-contract.mjs bench_logs/trace_contract.json
 *   node scripts/validate-trace-contract.mjs --fixture scripts/trace-validators/fixtures/trace-contract-pass.json
 *   curl -s "$JAEGER/api/traces/$TID" | node scripts/validate-trace-contract.mjs --stdin
 *
 * Env:
 *   TRACE_CONTRACT_REQUIRED_SERVICES — comma override (empty string = no required list)
 *   TRACE_CONTRACT_REQUIRE_ALL_SERVICES=1 — same as default dynamic full list (explicit CI flag)
 *   TRACE_CONTRACT_LEGACY_SUBSET=1 — use small default list (5 services) for quick local checks
 *   TRACE_CONTRACT_MIN_SPANS — default max(10, required.length+1) when using dynamic required
 *   TRACE_CONTRACT_MIN_DEPTH (default 3)
 *   TRACE_CONTRACT_REQUIRE_NET_PROTO=1 (default 1)
 *   TRACE_CONTRACT_REQUIRE_TRACE_COVERAGE=1 — every span must have tag trace.coverage
 *   TRACE_LATENCY_BUDGET_MS, TRACE_LATENCY_BUDGETS_FILE
 *   JAEGER_QUERY_BASE — when set, TRACE_CONTRACT_REPORT_JSON includes jaegerTraceUrl for the trace
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrace } from "./trace-validators/lib/jaeger-traces.mjs";
import { traceSpansHaveNetProto } from "./trace-validators/step7-strict-span-invariant.mjs";
import {
  computeCriticalPath,
  computeServiceContribution,
  extractRootHttpRoute,
  maxTreeDepth,
} from "./lib/trace-analysis.mjs";
import { discoverJaegerHousingServices } from "./trace-validators/lib/housing-services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

function hasFlag(argv, f) {
  return argv.includes(f);
}

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (String(v).startsWith("-")) return def;
  return v;
}

function loadJsonPath(p) {
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function extractTraceObject(j) {
  if (Array.isArray(j.data) && j.data[0]) return normalizeTrace(j.data[0]);
  if (j.traceID && j.spans) return normalizeTrace(j);
  return normalizeTrace(j);
}

function tagHasCoverage(span) {
  const tags = span.tags || [];
  return tags.some((t) => String(t.key || "").toLowerCase() === "trace.coverage");
}

function resolveRequired() {
  const legacy = process.env.TRACE_CONTRACT_LEGACY_SUBSET === "1";
  if (legacy) {
    return ["api-gateway", "auth-service", "listings-service", "trust-service", "booking-service"];
  }
  if (process.env.TRACE_CONTRACT_REQUIRED_SERVICES !== undefined) {
    const raw = process.env.TRACE_CONTRACT_REQUIRED_SERVICES;
    if (raw === "") return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (process.env.TRACE_CONTRACT_REQUIRE_ALL_SERVICES === "0") {
    return ["api-gateway", "auth-service", "listings-service", "trust-service", "booking-service"];
  }
  return discoverJaegerHousingServices(REPO);
}

function validate(trace, opts) {
  const errors = [];
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const services = new Set(spans.map((s) => {
    const pid = s.processID;
    return processes?.[pid]?.serviceName || "";
  }).filter(Boolean));

  for (const req of opts.required) {
    const ok = [...services].some((x) => x === req || x.includes(req));
    if (!ok) errors.push(`missing_service:${req}`);
  }

  if (spans.length < opts.minSpans) errors.push(`span_count:${spans.length}<${opts.minSpans}`);
  const depth = maxTreeDepth(trace);
  if (depth < opts.minDepth) errors.push(`depth:${depth}<${opts.minDepth}`);

  if (opts.requireNetProto) {
    const pr = traceSpansHaveNetProto(trace);
    if (!pr.ok) errors.push(...pr.violations.map((v) => `net_proto:${v.detail}`));
  }

  if (opts.requireTraceCoverage) {
    for (const s of spans) {
      if (!tagHasCoverage(s)) {
        errors.push(`trace.coverage missing on span ${s.spanID}`);
      }
    }
  }

  const cp = computeCriticalPath(trace);
  const endpoint = extractRootHttpRoute(trace);
  let budgetMs = opts.globalBudgetMs;
  if (opts.budgetsByRoute && endpoint) {
    const b = opts.budgetsByRoute[endpoint] ?? opts.budgetsByRoute["*"];
    if (typeof b === "number") budgetMs = b;
  }
  if (budgetMs != null && cp.criticalPathMs > budgetMs) {
    errors.push(`latency_budget:${cp.criticalPathMs.toFixed(1)}ms>${budgetMs}ms`);
  }

  const contrib = computeServiceContribution(trace);
  return {
    ok: errors.length === 0,
    errors,
    services: [...services],
    spanCount: spans.length,
    depth,
    criticalPathMs: cp.criticalPathMs,
    criticalPath: cp.path,
    endpoint,
    serviceContribution: contrib.byService,
    serviceContributionSorted: contrib.sorted,
    requiredConfigured: opts.required,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    console.error("Usage: node scripts/validate-trace-contract.mjs [--fixture PATH] [--stdin] [trace.json]");
    process.exit(1);
  }

  const required = resolveRequired();
  const defaultMinSpans = Math.max(10, required.length + 1);
  const minSpans = Number(process.env.TRACE_CONTRACT_MIN_SPANS || String(defaultMinSpans));
  const minDepth = Number(process.env.TRACE_CONTRACT_MIN_DEPTH || "3");
  const requireNetProto = process.env.TRACE_CONTRACT_REQUIRE_NET_PROTO !== "0";
  const requireTraceCoverage = process.env.TRACE_CONTRACT_REQUIRE_TRACE_COVERAGE === "1";
  const globalBudgetMs = process.env.TRACE_LATENCY_BUDGET_MS ? Number(process.env.TRACE_LATENCY_BUDGET_MS) : null;
  const budgetsFile = process.env.TRACE_LATENCY_BUDGETS_FILE || join(REPO, "infra/trace_latency_budgets.json");
  let budgetsByRoute = null;
  try {
    if (existsSync(budgetsFile)) {
      budgetsByRoute = JSON.parse(readFileSync(budgetsFile, "utf8"));
    }
  } catch {
    /* ignore */
  }

  let j;
  if (hasFlag(argv, "--stdin")) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } else if (hasFlag(argv, "--fixture")) {
    const p = getArg(argv, "--fixture", "");
    j = loadJsonPath(p.startsWith("/") ? p : join(REPO, p));
  } else {
    const p = argv.find((a) => !a.startsWith("-"));
    if (!p) {
      console.error("Missing trace json path");
      process.exit(2);
    }
    j = loadJsonPath(p.startsWith("/") ? p : join(process.cwd(), p));
  }

  const trace = extractTraceObject(j);
  if (!trace?.spans?.length) {
    console.error("No spans in trace");
    process.exit(1);
  }

  const outPath = process.env.TRACE_CONTRACT_REPORT_JSON;
  const result = validate(trace, {
    required,
    minSpans,
    minDepth,
    requireNetProto,
    requireTraceCoverage,
    globalBudgetMs,
    budgetsByRoute,
  });

  const traceId = trace.traceID || trace.spans?.[0]?.traceID || "";
  const jaegerBase = (process.env.JAEGER_QUERY_BASE || "").replace(/\/$/, "");
  const jaegerTraceUrl =
    traceId && jaegerBase ? `${jaegerBase}/trace/${traceId}` : undefined;

  const report = {
    status: result.ok ? "PASS" : "FAIL",
    ...result,
    traceId: traceId || undefined,
    jaegerTraceUrl,
    timestamp: new Date().toISOString(),
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!result.ok) {
    console.error("TRACE CONTRACT FAIL:", result.errors.join("; "));
    process.exit(1);
  }
  console.log("TRACE CONTRACT PASS", JSON.stringify({ services: result.services, depth: result.depth, criticalPathMs: result.criticalPathMs }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
