#!/usr/bin/env node
/**
 * LTL-style rules on bench_logs/trace_contract.json (Jaeger trace export shape: { data: [{ spans, processes }] }).
 *
 * Rules (best-effort on first trace in file):
 *  - gateway_first: earliest root span must be api-gateway
 *  - booking_requires_auth: any booking-service span must have a prior auth-service span in same trace
 *  - listing_then_analytics: POST /listings → analytics-service within 5s (same trace)
 *
 * Env: OCH_LTL_ENFORCE=1 or PREFLIGHT_REQUIRE_FORMAL_TRACE_GATES=1 → exit 1 on violation
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");
const TRACE = join(BENCH, "trace_contract.json");
const OUT = join(BENCH, "trace-ltl-report.json");

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
  const p = processes?.[span.processID];
  return p?.serviceName || "unknown";
}

function roots(spans) {
  const byId = new Set(spans.map((s) => s.spanID));
  return spans.filter((s) => {
    const refs = Array.isArray(s.references) ? s.references : [];
    for (const r of refs) {
      if (r.refType === "CHILD_OF" && r.spanID && byId.has(r.spanID)) return false;
    }
    return true;
  });
}

function enforce() {
  return process.env.OCH_LTL_ENFORCE === "1" || process.env.PREFLIGHT_REQUIRE_FORMAL_TRACE_GATES === "1";
}

function main() {
  mkdirSync(BENCH, { recursive: true });
  const trace = loadFirstTrace();
  const violations = [];
  if (!trace) {
    const doc = { ok: true, skipped: true, reason: "no_trace_contract" };
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    console.error("trace-ltl-validator: no trace — soft OK");
    process.exit(0);
  }
  const { spans, processes } = trace;
  const rs = roots(spans);
  if (rs.length) {
    rs.sort((a, b) => Number(a.startTime) - Number(b.startTime));
    const firstSvc = serviceName(rs[0], processes);
    if (firstSvc !== "api-gateway") {
      violations.push({ rule: "gateway_first", detail: `first_root_service=${firstSvc}` });
    }
  }

  const byStart = [...spans].sort((a, b) => Number(a.startTime) - Number(b.startTime));
  for (const s of spans) {
    if (serviceName(s, processes) !== "booking-service") continue;
    const t0 = Number(s.startTime);
    const priorAuth = byStart.find((x) => serviceName(x, processes) === "auth-service" && Number(x.startTime) < t0);
    if (!priorAuth) {
      violations.push({ rule: "booking_requires_auth", span: s.spanID, op: s.operationName });
    }
  }

  const listingPosts = spans.filter((s) => {
    if (serviceName(s, processes) !== "listings-service") return false;
    const op = String(s.operationName || "");
    const up = op.toUpperCase();
    return up.includes("POST") && op.includes("/listings");
  });
  for (const lp of listingPosts) {
    const t0 = Number(lp.startTime);
    const win = 5_000_000;
    const hit = spans.find(
      (x) =>
        serviceName(x, processes) === "analytics-service" &&
        Number(x.startTime) >= t0 &&
        Number(x.startTime) <= t0 + win,
    );
    if (!hit) {
      violations.push({ rule: "listing_then_analytics", listingSpan: lp.spanID, window_us: win });
    }
  }

  const ok = violations.length === 0;
  const doc = { specVersion: "och-trace-ltl-v1", ok, violations, tracePath: TRACE };
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  if (!ok) console.error("trace-ltl-validator: violations", JSON.stringify(violations, null, 2));
  if (!ok && enforce()) process.exit(1);
  process.exit(0);
}

main();
