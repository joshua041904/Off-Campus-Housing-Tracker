#!/usr/bin/env node
/**
 * Data-driven Jaeger structural verification: N services on one trace, single root,
 * optional min depth, optional PRODUCER/CONSUMER span.kind (OTel → Jaeger tags).
 *
 * Optional machine-readable reports (JSON + Markdown + alerts + OpenMetrics textfile):
 *   --report-dir bench_logs/trace-validation-<stamp>
 *   --record-registry <exitcode>  — append Jaeger service registry gate (after verify-jaeger-tracing-services.sh)
 *
 * Env: JAEGER_QUERY_BASE (required except --list-flows / --record-registry with existing report)
 *      TRACE_FLOWS_JSON — default <repo>/infra/observability/trace-flows.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxTraceDepth } from "./trace-validators/lib/jaeger-max-trace-depth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function repoFlowsPath() {
  return process.env.TRACE_FLOWS_JSON || join(REPO_ROOT, "infra/observability/trace-flows.json");
}

function usage() {
  console.error(`Usage:
  JAEGER_QUERY_BASE=http://host:16686 node scripts/verify-jaeger-trace-flows.mjs --flow <name> [--report-dir DIR] [--strict-span-tree-contract]
  node scripts/verify-jaeger-trace-flows.mjs --list-flows [--flows-json PATH]
  node scripts/verify-jaeger-trace-flows.mjs --services s1,s2,... [--seed-service S] [--require-producer] [--require-consumer]
       [--min-span-count N] [--min-trace-depth D] [--lookback SEC] [--retries N] [--sleep-ms MS] [--limit N] [--report-dir DIR] [--strict-span-tree-contract]
  node scripts/verify-jaeger-trace-flows.mjs --report-dir DIR --record-registry <exitcode> [--registry-message "text"]
`);
}

function getArg(argv, name, def = undefined) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (typeof v === "string" && v.startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function loadFlows(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function tagValue(span, wantKey) {
  const tags = span.tags || [];
  const w = wantKey.toLowerCase();
  for (const t of tags) {
    if (String(t.key || "").toLowerCase() === w) return t.value;
  }
  return undefined;
}

function serviceName(span, processes) {
  const pid = span.processID;
  const p = processes?.[pid];
  return p?.serviceName || "";
}

function opMatches(name) {
  if (!name || typeof name !== "string") return false;
  const o = name.toLowerCase();
  return (
    /^HTTP\s+(GET|POST|PUT|PATCH|DELETE)/i.test(name) ||
    o.includes("booking") ||
    o.includes("grpc") ||
    o.includes("listing") ||
    o.includes("message") ||
    o.includes("forum") ||
    o.includes("trust") ||
    o.includes("flag") ||
    o.includes("media") ||
    o.includes("health") ||
    o.includes("analytics") ||
    o.includes("insight") ||
    o.includes("metric") ||
    o.includes("auth") ||
    o.includes("login") ||
    o.includes("register") ||
    o.includes("passkey") ||
    o.includes("notif") ||
    o.includes("preference") ||
    o.includes("kafka")
  );
}

function spanMap(spans) {
  const m = new Map();
  for (const s of spans) {
    m.set(String(s.spanID), s);
    if (s.spanID != null) m.set(s.spanID, s);
  }
  return m;
}

function producerConsumerFlags(spans) {
  let producerSpanFound = false;
  let consumerSpanFound = false;
  for (const s of spans || []) {
    const k = String(tagValue(s, "span.kind") || "").toLowerCase();
    if (k === "producer") producerSpanFound = true;
    if (k === "consumer") consumerSpanFound = true;
  }
  return { producerSpanFound, consumerSpanFound };
}

function validateTrace(trace, flow, opts = {}) {
  const strict = Boolean(opts.strictSpanTreeContract);
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const required = flow.services.map((s) => s.trim()).filter(Boolean);
  const minSpan = flow.minSpanCount ?? Math.max(2, required.length);
  const minDepth = flow.minTraceDepth ?? (flow.requireProducer || flow.requireConsumer ? 3 : 2);
  const requireRoot = flow.requireSingleRoot !== false;
  const { producerSpanFound, consumerSpanFound } = producerConsumerFlags(spans);

  if (spans.length < minSpan) {
    return { ok: false, err: `need >=${minSpan} spans, got ${spans.length}`, producerSpanFound, consumerSpanFound };
  }

  for (const s of spans) {
    const dur = Number(s.duration ?? 0);
    if (!Number.isFinite(dur) || dur < 0) {
      return { ok: false, err: "span duration invalid", producerSpanFound, consumerSpanFound };
    }
    if ((s.startTime ?? 0) <= 0) {
      return { ok: false, err: "invalid startTime", producerSpanFound, consumerSpanFound };
    }
  }

  const svcs = [...new Set(spans.map((s) => serviceName(s, processes)))];
  for (const r of required) {
    if (!svcs.includes(r)) {
      return {
        ok: false,
        err: `missing service ${r}; have ${svcs.join(",")}`,
        producerSpanFound,
        consumerSpanFound,
      };
    }
  }

  const hasOp = spans.some((s) => opMatches(s.operationName));
  if (!hasOp) {
    return { ok: false, err: "no span matched operation heuristic (HTTP/domain/kafka)", producerSpanFound, consumerSpanFound };
  }

  const roots = spans.filter((s) => !(s.references && s.references.length));
  if (requireRoot && roots.length !== 1) {
    return {
      ok: false,
      err: `need exactly 1 root span, got ${roots.length}`,
      producerSpanFound,
      consumerSpanFound,
    };
  }
  if (requireRoot) {
    const rid = String(roots[0].spanID);
    for (const s of spans) {
      const refs = s.references || [];
      const isRoot = String(s.spanID) === rid;
      if (!isRoot && refs.length === 0) {
        return { ok: false, err: "non-root span without references", producerSpanFound, consumerSpanFound };
      }
    }
  }

  if (strict && requireRoot && roots.length === 1) {
    const rsvc = serviceName(roots[0], processes);
    if (rsvc !== "api-gateway") {
      return {
        ok: false,
        err: `strict: root span service must be api-gateway, got "${rsvc}"`,
        producerSpanFound,
        consumerSpanFound,
      };
    }
  }

  if (strict) {
    for (const s of spans) {
      const code = tagValue(s, "http.status_code");
      if (code != null && !Number.isNaN(Number(code)) && Number(code) >= 500) {
        return {
          ok: false,
          err: `strict: span has http.status_code>=500 (${code})`,
          producerSpanFound,
          consumerSpanFound,
        };
      }
    }
  }

  if (strict) {
    const byId = spanMap(spans);
    for (const s of spans) {
      for (const ref of s.references || []) {
        const pid = ref.spanID != null ? String(ref.spanID) : "";
        if (!pid) continue;
        if (ref.refType === "CHILD_OF" && !byId.has(pid)) {
          return {
            ok: false,
            err: `strict: CHILD_OF references missing parent spanID ${pid}`,
            producerSpanFound,
            consumerSpanFound,
          };
        }
      }
    }
  }

  if (strict) {
    const tid = String(trace.traceID || "");
    if (tid) {
      for (const s of spans) {
        if (s.traceID != null && String(s.traceID) !== tid) {
          return {
            ok: false,
            err: `strict: span traceID mismatch (expected ${tid})`,
            producerSpanFound,
            consumerSpanFound,
          };
        }
      }
    }
  }

  const depth = maxTraceDepth(spans);
  if (depth < minDepth) {
    return {
      ok: false,
      err: `minTraceDepth want >=${minDepth}, got ${depth}`,
      producerSpanFound,
      consumerSpanFound,
    };
  }

  if (flow.requireProducer) {
    if (!producerSpanFound) {
      return { ok: false, err: "requireProducer: no span.kind=producer", producerSpanFound, consumerSpanFound };
    }
  }
  if (flow.requireConsumer) {
    if (!consumerSpanFound) {
      return { ok: false, err: "requireConsumer: no span.kind=consumer", producerSpanFound, consumerSpanFound };
    }
  }

  return {
    ok: true,
    traceID: trace.traceID,
    depth,
    spanCount: spans.length,
    producerSpanFound,
    consumerSpanFound,
  };
}

function emptyReport(jaegerBase) {
  return {
    timestamp: new Date().toISOString(),
    jaegerBase,
    registryCheck: null,
    results: [],
  };
}

function readReport(dir) {
  const p = join(dir, "trace-validation-report.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function upsertFlowResult(state, row) {
  const idx = state.results.findIndex((r) => r.flow === row.flow);
  if (idx === -1) state.results.push(row);
  else state.results[idx] = row;
}

function recomputeAggregates(state) {
  state.flowsValidated = state.results.length;
  state.flowsPassed = state.results.filter((r) => r.status === "PASS").length;
  state.flowsFailed = state.results.filter((r) => r.status === "FAIL").length;
  if (state.registryCheck) {
    state.registryGatePassed = state.registryCheck.status === "PASS";
  } else {
    state.registryGatePassed = null;
  }
}

function renderMarkdown(state) {
  const lines = [
    "# Distributed trace validation summary",
    "",
    `Generated: **${state.timestamp}**`,
    `Jaeger: \`${state.jaegerBase}\``,
    "",
  ];
  if (state.registryCheck) {
    lines.push("## Jaeger service registry");
    lines.push(`Status: **${state.registryCheck.status}**`);
    lines.push(`Detail: ${state.registryCheck.detail || ""}`);
    lines.push("");
  }
  lines.push(`Flows checked: **${state.flowsValidated}**`);
  lines.push(`Passed: **${state.flowsPassed}**`);
  lines.push(`Failed: **${state.flowsFailed}**`);
  lines.push("");
  for (const r of state.results) {
    lines.push(`## ${r.flow}`);
    lines.push(`- Status: **${r.status}**`);
    if (r.traceId) lines.push(`- Trace ID: \`${r.traceId}\``);
    if (r.spanCount != null) lines.push(`- Spans: ${r.spanCount}`);
    if (r.depth != null) lines.push(`- Depth: ${r.depth}`);
    if (r.services) lines.push(`- Services: ${r.services.join(", ")}`);
    if (r.producerSpanFound != null) lines.push(`- Producer span: ${r.producerSpanFound ? "✓" : "—"}`);
    if (r.consumerSpanFound != null) lines.push(`- Consumer span: ${r.consumerSpanFound ? "✓" : "—"}`);
    if (r.error) lines.push(`- Error: ${r.error}`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderAlerts(state) {
  const lines = [];
  if (state.registryCheck && state.registryCheck.status !== "PASS") {
    lines.push(
      `[CRITICAL] Jaeger service registry failed: ${state.registryCheck.detail || "verify-jaeger-tracing-services.sh"}`,
    );
  }
  for (const r of state.results) {
    if (r.status !== "PASS") {
      lines.push(`[CRITICAL] Flow ${r.flow} failed: ${r.error || "unknown"}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function renderProm(state) {
  const out = [
    "# HELP trace_flow_validation_pass 1 if Jaeger structural flow validation passed on last run; 0 if failed",
    "# TYPE trace_flow_validation_pass gauge",
  ];
  if (state.registryCheck) {
    const v = state.registryCheck.status === "PASS" ? 1 : 0;
    out.push(`trace_flow_validation_pass{gate="jaeger_service_registry"} ${v}`);
  }
  for (const r of state.results) {
    const v = r.status === "PASS" ? 1 : 0;
    out.push(`trace_flow_validation_pass{flow="${String(r.flow).replace(/"/g, "")}"} ${v}`);
  }
  return `${out.join("\n")}\n`;
}

function persistReport(dir, state) {
  mkdirSync(dir, { recursive: true });
  state.timestamp = new Date().toISOString();
  recomputeAggregates(state);
  writeFileSync(join(dir, "trace-validation-report.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "trace-validation-summary.md"), renderMarkdown(state), "utf8");
  writeFileSync(join(dir, "trace-validation-alerts.log"), renderAlerts(state), "utf8");
  writeFileSync(join(dir, "trace_flow_validation.prom"), renderProm(state), "utf8");
}

function mergeReport(dir, jaegerBase, mutator) {
  mkdirSync(dir, { recursive: true });
  let state = readReport(dir);
  if (!state) state = emptyReport(jaegerBase);
  state.jaegerBase = jaegerBase;
  mutator(state);
  recomputeAggregates(state);
  persistReport(dir, state);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

function buildUrl(base, service, lookbackSec, limit) {
  const end = Date.now() * 1000;
  const start = (Date.now() - lookbackSec * 1000) * 1000;
  const enc = encodeURIComponent(service);
  return `${base}/api/traces?service=${enc}&start=${start}&end=${end}&limit=${limit}`;
}

function findFlow(flowsDoc, name) {
  const flows = flowsDoc.flows || [];
  const f = flows.find((x) => x.name === name);
  if (!f) throw new Error(`Unknown flow "${name}" in ${repoFlowsPath()}`);
  if (f.enabled === false) throw new Error(`Flow "${name}" is disabled (enabled: false)`);
  return f;
}

async function runFlow(base, flow, opts) {
  const { lookback, retries, sleepMs, limit, strictSpanTreeContract } = opts;
  const seed =
    flow.seedService ||
    flow.services[flow.services.length - 1] ||
    flow.services[0];

  let lastErr = "no matching trace in lookback";

  for (let attempt = 1; attempt <= retries; attempt++) {
    const url = buildUrl(base, seed, lookback, limit);
    console.error(
      `verify-jaeger-trace-flows: flow=${flow.name} attempt ${attempt}/${retries} seed=${seed} lookback=${lookback}s`,
    );
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      lastErr = `fetch: ${e?.message || e}`;
      console.error(`verify-jaeger-trace-flows: fetch failed`, lastErr);
      if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
      continue;
    }
    const traces = data.data || [];
    for (const t of traces) {
      const v = validateTrace(t, flow, { strictSpanTreeContract });
      if (v.ok) {
        const { producerSpanFound, consumerSpanFound } = v;
        console.log(
          `verify-jaeger-trace-flows: OK flow=${flow.name} traceID=${v.traceID} services=[${flow.services.join(
            ",",
          )}] depth=${v.depth} spans=${v.spanCount}`,
        );
        return {
          ok: true,
          flow: flow.name,
          traceId: v.traceID,
          spanCount: v.spanCount,
          depth: v.depth,
          services: [...flow.services],
          producerSpanFound,
          consumerSpanFound,
        };
      }
      lastErr = v.err || "validation failed";
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
  }
  console.error(`verify-jaeger-trace-flows: flow=${flow.name} failed after ${retries} attempts`);
  return {
    ok: false,
    flow: flow.name,
    services: [...flow.services],
    error: lastErr,
    producerSpanFound: false,
    consumerSpanFound: false,
  };
}

function recordRegistry(dir, jaegerBase, exitCode, message) {
  mergeReport(dir, jaegerBase, (state) => {
    state.registryCheck = {
      status: exitCode === 0 ? "PASS" : "FAIL",
      detail: message || (exitCode === 0 ? "verify-jaeger-tracing-services.sh OK" : `exit ${exitCode}`),
    };
  });
}

function recordFlow(dir, jaegerBase, res) {
  mergeReport(dir, jaegerBase, (state) => {
    upsertFlowResult(state, {
      flow: res.flow,
      status: res.ok ? "PASS" : "FAIL",
      traceId: res.traceId || null,
      spanCount: res.spanCount ?? null,
      depth: res.depth ?? null,
      services: res.services || [],
      producerSpanFound: res.producerSpanFound ?? null,
      consumerSpanFound: res.consumerSpanFound ?? null,
      error: res.error || null,
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    usage();
    process.exit(1);
  }

  if (hasFlag(argv, "--list-flows")) {
    const path = getArg(argv, "--flows-json", repoFlowsPath());
    const doc = loadFlows(path);
    for (const f of doc.flows || []) {
      const en = f.enabled === false ? " (disabled)" : "";
      console.log(`${f.name}${en}`);
    }
    return;
  }

  const reportDir = getArg(argv, "--report-dir");
  const base = (process.env.JAEGER_QUERY_BASE || "").replace(/\/$/, "");

  if (hasFlag(argv, "--record-registry")) {
    const codeStr = getArg(argv, "--record-registry", "1");
    const code = Number(codeStr);
    const msg = getArg(argv, "--registry-message", "");
    if (!reportDir) {
      console.error("verify-jaeger-trace-flows: --report-dir required with --record-registry");
      process.exit(1);
    }
    if (!base) {
      console.error("verify-jaeger-trace-flows: JAEGER_QUERY_BASE required for report");
      process.exit(1);
    }
    recordRegistry(reportDir, base, Number.isFinite(code) ? code : 1, msg);
    console.log(`verify-jaeger-trace-flows: registry recorded (exit ${codeStr}) → ${reportDir}`);
    return;
  }

  const lookback = Number(getArg(argv, "--lookback", "600"));
  const retries = Number(getArg(argv, "--retries", "8"));
  const sleepMs = Number(getArg(argv, "--sleep-ms", "3000"));
  const limit = Number(getArg(argv, "--limit", "25"));
  const flowsPath = getArg(argv, "--flows-json", repoFlowsPath());

  let flow;
  if (hasFlag(argv, "--flow")) {
    const name = getArg(argv, "--flow");
    if (!name) {
      usage();
      process.exit(1);
    }
    const doc = loadFlows(flowsPath);
    flow = findFlow(doc, name);
  } else if (hasFlag(argv, "--services")) {
    const raw = getArg(argv, "--services");
    if (!raw) {
      usage();
      process.exit(1);
    }
    const services = raw.split(",").map((s) => s.trim()).filter(Boolean);
    flow = {
      name: "cli",
      services,
      seedService: getArg(argv, "--seed-service", services[services.length - 1] || services[0]),
      requireProducer: hasFlag(argv, "--require-producer"),
      requireConsumer: hasFlag(argv, "--require-consumer"),
      minSpanCount: getArg(argv, "--min-span-count")
        ? Number(getArg(argv, "--min-span-count"))
        : undefined,
      minTraceDepth: getArg(argv, "--min-trace-depth")
        ? Number(getArg(argv, "--min-trace-depth"))
        : undefined,
      requireSingleRoot: true,
    };
  } else {
    usage();
    process.exit(1);
  }

  if (!base) {
    console.error("verify-jaeger-trace-flows: set JAEGER_QUERY_BASE (Jaeger query origin, e.g. http://host:16686)");
    process.exit(1);
  }

  const strictSpanTreeContract = hasFlag(argv, "--strict-span-tree-contract");
  const res = await runFlow(base, flow, { lookback, retries, sleepMs, limit, strictSpanTreeContract });
  if (reportDir) {
    recordFlow(reportDir, base, res);
  }
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
