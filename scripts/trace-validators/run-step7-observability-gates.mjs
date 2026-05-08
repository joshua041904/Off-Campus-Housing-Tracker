#!/usr/bin/env node
/**
 * Orchestrates Step 7 observability gates: span-tree (7B) + overlap (O1–O4).
 * Writes unified JSON to --report-dir for CI / drift tooling.
 *
 * Env: JAEGER_QUERY_BASE (required)
 *      STEP7_SEED_SERVICE (default api-gateway)
 *      STEP7_LOOKBACK_SEC (default 900)
 *      STEP7_MIN_SPANS — default 4 list mode; canonical contract defaults max(18, 2× discovered services) / 2 canonical loose
 *      STEP7_MIN_DEPTH — default 3 canonical contract / 2 otherwise
 *      STEP7_REQUIRED_SERVICES — comma list; canonical mode defaults to repo discovery (api-gateway + services/*-service) unless set
 *      STEP7_CANONICAL_CONTRACT=0 — disable strict multi-service defaults when STEP7_CANONICAL_TRACE_ID is set
 *      STEP7_CANONICAL_TRACE_ID — if set, fetch only this trace from Jaeger (deterministic gate)
 *      STEP7_POST_SEED_SLEEP_MS — initial wait before polling canonical trace (default 2000 when canonical)
 *      STEP7_CANONICAL_POLL_ATTEMPTS (default 15), STEP7_CANONICAL_POLL_MS (default 1000)
 *      STEP7_DIAG_CONTINUITY=1 — on failure, attach last trace’s service-chain / overlap sample to JSON + stderr
 *      STEP7_SKIP_TRACE_ID_CONSISTENCY=1 — do not require all spans’ traceID to match root (escape hatch only)
 *      STEP7_REQUIRE_NET_PROTO=1 — every span must carry tag net.proto (transport-aware tracing)
 *      STEP7_DEBUG_DUMP=1 — write step7-trace-debug.json with last evaluated trace
 *      STEP7_PROPAGATION_AUDIT_DUMP=1 — write step7-canonical-span-parentage.json (spanId, parentSpanId, service, op) for last trace
 *      On canonical trace failure, step7-canonical-span-parentage.json is written automatically when lastTrace exists (propagation triage)
 *      STEP7_STRICT=0 — exit 0 even when gates fail (dev soft-fail; stderr still reports FAIL)
 *      STEP7_LAST_PASSING_FILE — override path to last passing trace snapshot (default ./bench_logs/step7-last-passing-trace.json)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTracesUrl, fetchJson, fetchTraceById, normalizeTrace, serviceName } from "./lib/jaeger-traces.mjs";
import { discoverJaegerHousingServices } from "./lib/housing-services.mjs";
import {
  parentRef,
  traceSpansHaveNetProto,
  validateSpanTreeInvariant,
} from "./step7-strict-span-invariant.mjs";
import { diagnoseServiceChain, validateSingleTraceIdConsistency } from "./trace-service-continuity.mjs";
import { validateOverlapInvariant } from "./trace-overlap-validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (String(v).startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTraces(base, service, lookback, limit) {
  const url = buildTracesUrl(base, service, lookback, limit);
  const data = await fetchJson(url);
  return data.data || [];
}

function defaultLastPassingPath() {
  return join(process.cwd(), "bench_logs/step7-last-passing-trace.json");
}

function loadLastPassing(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function summarizeTrace(trace, tree) {
  const processes = trace.processes || {};
  const names = (trace.spans || []).map((s) => ({
    id: String(s.spanID),
    op: s.operationName,
    svc: serviceName(s, processes),
  }));
  return {
    traceID: trace.traceID,
    spanCount: tree.spanCount,
    depth: tree.depth,
    services: tree.services,
    operations: names,
  };
}

function diffAgainstLastPassing(last, current) {
  if (!last?.services) return null;
  const prevS = new Set(last.services || []);
  const curS = new Set(current.services || []);
  const added = [...curS].filter((x) => !prevS.has(x));
  const removed = [...prevS].filter((x) => !curS.has(x));
  return {
    previousRecordedAt: last.timestamp,
    previousTraceID: last.traceID,
    spanCountDelta: (current.spanCount || 0) - (last.spanCount || 0),
    depthDelta: (current.depth || 0) - (last.depth || 0),
    servicesAdded: added,
    servicesRemoved: removed,
  };
}

/**
 * @param {{ trace: any, tree: any, overlap: any, traceIdConsistency: any, requireNetProto: boolean, minSpan: number, minDepth: number }} p
 */
function computeTraceScore(p) {
  const { trace, tree, overlap, traceIdConsistency, requireNetProto, minSpan, minDepth } = p;
  const spanN = tree.spanCount ?? 0;
  let score = 0;
  score += Math.min(30, Math.round((spanN / Math.max(1, minSpan)) * 30));
  score += Math.min(30, Math.round((tree.depth / Math.max(1, minDepth)) * 30));
  score += overlap.ok ? 20 : 5;
  score += traceIdConsistency.ok ? 10 : 0;
  if (requireNetProto) {
    const pr = traceSpansHaveNetProto(trace);
    score += pr.ok ? 10 : Math.max(0, 10 - (pr.violations?.length || 0) * 2);
  } else {
    score += 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Slim span parentage dump for propagation triage (S1/S3 / orphan parents). */
function writePropagationAudit(trace, reportDir, meta = {}) {
  if (!trace?.spans?.length) return;
  const processes = trace.processes || {};
  const spans = trace.spans;
  const rows = spans.map((s) => ({
    traceID: String(trace.traceID || s.traceID || ""),
    spanID: String(s.spanID || ""),
    parentSpanID: parentRef(s),
    isRoot: !(s.references && s.references.length),
    serviceName: serviceName(s, processes),
    operationName: String(s.operationName || ""),
  }));
  mkdirSync(reportDir, { recursive: true });
  const outPath = join(reportDir, "step7-canonical-span-parentage.json");
  const doc = {
    specVersion: "och-step7-propagation-audit-v1",
    generated_at: new Date().toISOString(),
    note:
      "parentSpanID from Jaeger CHILD_OF only (non-CHILD_OF refs ignored). S1 roots include spans with no CHILD_OF, CHILD_OF to a parent missing from this batch, or known remote placeholders (0000…00/01). S3 flags orphan CHILD_OF to a missing non-placeholder parent — fix propagation or Jaeger export.",
    ...meta,
    traceID: trace.traceID,
    spanCount: spans.length,
    spans: rows,
  };
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.error(`step7-observability: propagation audit → ${outPath} (${rows.length} spans)`);
}

function evaluateTrace(trace, opts) {
  const { minSpan, minDepth, required, requireNetProto, requireTid } = opts;
  const tree = validateSpanTreeInvariant(trace, {
    minSpanCount: minSpan,
    minDepth,
    requiredServices: required,
    requireNetProto,
  });
  const overlap = validateOverlapInvariant(trace, {});
  const traceIdConsistency = validateSingleTraceIdConsistency(trace);
  const ok = tree.ok && overlap.ok && (!requireTid || traceIdConsistency.ok);
  return { ok, tree, overlap, traceIdConsistency };
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    console.error(
      `Usage: JAEGER_QUERY_BASE=http://host:16686 node scripts/trace-validators/run-step7-observability-gates.mjs [--report-dir DIR] [--retries N] [--sleep-ms MS]`,
    );
    process.exit(1);
  }
  const base = process.env.JAEGER_QUERY_BASE?.replace(/\/$/, "");
  if (!base) {
    console.error("JAEGER_QUERY_BASE is required");
    process.exit(2);
  }
  const reportDir = getArg(argv, "--report-dir", join(process.cwd(), "bench_logs/step7-observability"));
  const retries = Number(getArg(argv, "--retries", process.env.STEP7_RETRIES || "8"));
  const sleepMs = Number(getArg(argv, "--sleep-ms", process.env.STEP7_SLEEP_MS || "2000"));
  const lookback = Number(process.env.STEP7_LOOKBACK_SEC || "900");
  const limit = Number(process.env.STEP7_TRACE_LIMIT || "25");
  const seed = process.env.STEP7_SEED_SERVICE || "api-gateway";
  const canonicalTid = (process.env.STEP7_CANONICAL_TRACE_ID || "").trim();
  /** Multi-service /api/debug/full-trace contract (preflight sets STEP7_CANONICAL_CONTRACT=1). */
  const canonicalContract = Boolean(canonicalTid) && process.env.STEP7_CANONICAL_CONTRACT !== "0";
  const discovered = discoverJaegerHousingServices(REPO_ROOT);
  const defaultMinSpan = canonicalContract
    ? String(Math.max(18, discovered.length * 2))
    : canonicalTid
      ? "2"
      : "4";
  const minSpan = Number(process.env.STEP7_MIN_SPANS || defaultMinSpan);
  const defaultMinDepth = canonicalContract ? "3" : "2";
  const minDepth = Number(process.env.STEP7_MIN_DEPTH || defaultMinDepth);
  const defaultRequired = canonicalContract ? discovered.join(",") : "";
  const requiredRaw = process.env.STEP7_REQUIRED_SERVICES;
  const required = (requiredRaw !== undefined ? requiredRaw : defaultRequired)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const specVersion = "och-observability-integrity-spec-v1";
  const requireNetProto = process.env.STEP7_REQUIRE_NET_PROTO === "1";
  const requireTid = process.env.STEP7_SKIP_TRACE_ID_CONSISTENCY !== "1";
  const lastPassingPath = process.env.STEP7_LAST_PASSING_FILE || defaultLastPassingPath();
  const debugDump = process.env.STEP7_DEBUG_DUMP === "1";
  const propagationAuditDump = process.env.STEP7_PROPAGATION_AUDIT_DUMP === "1";
  const strict = process.env.STEP7_STRICT !== "0";

  const opts = { minSpan, minDepth, required, requireNetProto, requireTid };

  let lastErr = "no trace passed gates";
  let lastContinuitySample = null;
  let lastTrace = null;
  let lastEval = null;

  const writePass = (trace, attempt, tree, overlap, traceIdConsistency, mode) => {
    const out = {
      specVersion,
      status: "PASS",
      traceID: trace.traceID,
      seed,
      attempt,
      mode,
      spanTree: { ...tree, violations: tree.violations },
      overlap: { ...overlap, violations: overlap.violations },
      traceIdConsistency,
      traceScore: computeTraceScore({
        trace,
        tree,
        overlap,
        traceIdConsistency,
        requireNetProto,
        minSpan,
        minDepth,
      }),
      timestamp: new Date().toISOString(),
    };
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, "step7-observability-gates.json"), `${JSON.stringify(out, null, 2)}\n`);
    try {
      mkdirSync(dirname(lastPassingPath), { recursive: true });
      writeFileSync(
        lastPassingPath,
        `${JSON.stringify(
          {
            ...summarizeTrace(trace, tree),
            timestamp: out.timestamp,
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      /* optional */
    }
    if (propagationAuditDump) {
      writePropagationAudit(trace, reportDir, { gateOutcome: "pass", mode });
    }
    console.log(
      `step7-observability: PASS trace=${trace.traceID} spans=${tree.spanCount} depth=${tree.depth} traceIdConsistency=${traceIdConsistency.ok} attempt=${attempt} mode=${mode}`,
    );
  };

  const writeFail = (extra = {}) => {
    if (lastTrace) {
      const mode = canonicalTid ? "canonical" : "list";
      writePropagationAudit(lastTrace, reportDir, {
        gateOutcome: "fail",
        mode,
        canonicalTraceId: canonicalTid || undefined,
      });
    }
    const fail = {
      specVersion,
      status: "FAIL",
      seed,
      lastError: lastErr,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    if (lastContinuitySample) {
      fail.continuitySample = lastContinuitySample;
      console.error(`step7-observability: continuity sample (STEP7_DIAG_CONTINUITY=1): ${JSON.stringify(lastContinuitySample)}`);
    }
    mkdirSync(reportDir, { recursive: true });
    if (extra.diffVsLastPassing) {
      writeFileSync(join(reportDir, "step7-trace-diff.json"), `${JSON.stringify(extra.diffVsLastPassing, null, 2)}\n`);
    }
    writeFileSync(join(reportDir, "step7-observability-gates.json"), `${JSON.stringify(fail, null, 2)}\n`);
    console.error(
      "step7-observability: FAIL — no trace satisfied span-tree + overlap (+ traceID consistency unless STEP7_SKIP_TRACE_ID_CONSISTENCY=1; + net.proto on all spans when STEP7_REQUIRE_NET_PROTO=1)",
    );
    if (!strict) {
      console.error("step7-observability: STEP7_STRICT=0 — soft-fail (exit 0)");
      process.exit(0);
    }
    process.exit(1);
  };

  if (canonicalTid) {
    const post =
      process.env.STEP7_POST_SEED_SLEEP_MS != null && process.env.STEP7_POST_SEED_SLEEP_MS !== ""
        ? Number(process.env.STEP7_POST_SEED_SLEEP_MS)
        : 2000;
    if (post > 0) await sleep(post);

    const pollAttempts = Number(process.env.STEP7_CANONICAL_POLL_ATTEMPTS || "15");
    const pollMs = Number(process.env.STEP7_CANONICAL_POLL_MS || "1000");

    for (let attempt = 1; attempt <= pollAttempts; attempt++) {
      let trace = null;
      try {
        trace = await fetchTraceById(base, canonicalTid);
      } catch (e) {
        lastErr = String(e?.message || e);
        console.error(`step7-observability: canonical fetch attempt ${attempt}/${pollAttempts} failed: ${lastErr}`);
        if (attempt < pollAttempts) await sleep(pollMs);
        continue;
      }
      if (process.env.STEP7_DIAG_CONTINUITY === "1" && trace?.spans?.length) {
        lastContinuitySample = diagnoseServiceChain(trace, required);
      }
      if (trace?.spans?.length) {
        lastTrace = trace;
        const ev = evaluateTrace(trace, opts);
        lastEval = ev;
        if (process.env.STEP7_DEBUG_DUMP === "1") {
          console.error(`step7-observability: trace dump (canonical attempt ${attempt}): ${JSON.stringify(trace, null, 2)}`);
        }
        if (ev.ok) {
          writePass(trace, attempt, ev.tree, ev.overlap, ev.traceIdConsistency, "canonical");
          process.exit(0);
        }
        lastErr = JSON.stringify({
          tree: ev.tree.violations,
          overlap: ev.overlap.violations,
          traceIdConsistency: ev.traceIdConsistency.violations,
        });
      } else {
        lastErr = "trace_not_found_or_empty";
      }
      console.error(`step7-observability: canonical attempt ${attempt}/${pollAttempts} no passing trace (${lastErr})`);
      if (attempt < pollAttempts) await sleep(pollMs);
    }

    const lastPassing = loadLastPassing(lastPassingPath);
    const scorePayload =
      lastTrace && lastEval
        ? {
            traceScore: computeTraceScore({
              trace: lastTrace,
              tree: lastEval.tree,
              overlap: lastEval.overlap,
              traceIdConsistency: lastEval.traceIdConsistency,
              requireNetProto,
              minSpan,
              minDepth,
            }),
            scoreBreakdownNote:
              "0–100 heuristic: span count + depth vs thresholds, overlap, traceId consistency, net.proto coverage",
            diffVsLastPassing: diffAgainstLastPassing(lastPassing, summarizeTrace(lastTrace, lastEval.tree)),
          }
        : {};

    if (debugDump && lastTrace) {
      writeFileSync(join(reportDir, "step7-trace-debug.json"), `${JSON.stringify(lastTrace, null, 2)}\n`);
    }

    writeFail(scorePayload);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    let traces;
    try {
      traces = await fetchTraces(base, seed, lookback, limit);
    } catch (e) {
      lastErr = String(e?.message || e);
      console.error(`step7-observability: fetch attempt ${attempt}/${retries} failed: ${lastErr}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
      continue;
    }
    for (const raw of traces) {
      const trace = normalizeTrace(raw);
      if (!trace?.spans?.length) continue;
      lastTrace = trace;
      if (process.env.STEP7_DIAG_CONTINUITY === "1") {
        lastContinuitySample = diagnoseServiceChain(trace, required);
      }
      const ev = evaluateTrace(trace, opts);
      lastEval = ev;
      if (debugDump) {
        console.error(`step7-observability: trace dump (list mode): ${JSON.stringify(trace, null, 2)}`);
      }
      if (ev.ok) {
        writePass(trace, attempt, ev.tree, ev.overlap, ev.traceIdConsistency, "list");
        process.exit(0);
      }
      lastErr = JSON.stringify({
        tree: ev.tree.violations,
        overlap: ev.overlap.violations,
        traceIdConsistency: ev.traceIdConsistency.violations,
      });
    }
    console.error(`step7-observability: attempt ${attempt}/${retries} no passing trace`);
    if (attempt < retries) await new Promise((r) => setTimeout(r, sleepMs));
  }

  const lastPassing = loadLastPassing(lastPassingPath);
  const scorePayload =
    lastTrace && lastEval
      ? {
          traceScore: computeTraceScore({
            trace: lastTrace,
            tree: lastEval.tree,
            overlap: lastEval.overlap,
            traceIdConsistency: lastEval.traceIdConsistency,
            requireNetProto,
            minSpan,
            minDepth,
          }),
          diffVsLastPassing: diffAgainstLastPassing(lastPassing, summarizeTrace(lastTrace, lastEval.tree)),
        }
      : {};

  if (debugDump && lastTrace) {
    writeFileSync(join(reportDir, "step7-trace-debug.json"), `${JSON.stringify(lastTrace, null, 2)}\n`);
  }

  writeFail(scorePayload);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
