#!/usr/bin/env node
/**
 * Jaeger-style trace JSON: parent/child start+duration ordering (CHILD_OF).
 * Input: bench_logs/trace_contract.json or path via --trace=
 * Output: bench_logs/trace-temporal-report.json (exit 0; violations printed to stderr).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");

function argvVal(prefix) {
  const a = process.argv.find((x) => x.startsWith(prefix));
  if (!a) return "";
  return a.slice(prefix.length);
}

function loadTrace(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeTrace(j) {
  if (!j) return null;
  if (Array.isArray(j.spans)) return j;
  const t0 = j?.data?.[0];
  if (t0 && Array.isArray(t0.spans)) return t0;
  return null;
}

function main() {
  const tracePath = argvVal("--trace=") || join(BENCH, "trace_contract.json");
  const raw = loadTrace(tracePath);
  const j = normalizeTrace(raw);
  mkdirSync(BENCH, { recursive: true });
  const violations = [];
  if (!j || !Array.isArray(j.spans)) {
    writeFileSync(
      join(BENCH, "trace-temporal-report.json"),
      `${JSON.stringify({ ok: false, reason: "no_spans", tracePath }, null, 2)}\n`,
    );
    console.error("trace-temporal-invariants: no spans — wrote stub report");
    process.exit(0);
  }
  const byId = new Map(j.spans.map((s) => [s.spanID, s]));
  const EPS = 50_000;
  for (const span of j.spans) {
    const refs = Array.isArray(span.references) ? span.references : [];
    for (const r of refs) {
      if (r.refType !== "CHILD_OF" || !r.spanID) continue;
      const parent = byId.get(r.spanID);
      if (!parent) continue;
      const c0 = Number(span.startTime);
      const p0 = Number(parent.startTime);
      const cd = Number(span.duration) || 0;
      const pd = Number(parent.duration) || 0;
      if (!(Number.isFinite(c0) && Number.isFinite(p0))) continue;
      if (c0 + EPS < p0) {
        violations.push({ child: span.spanID, parent: parent.spanID, kind: "child_starts_before_parent", c0, p0 });
      }
      const cEnd = c0 + cd;
      const pEnd = p0 + pd;
      if (Number.isFinite(cEnd) && Number.isFinite(pEnd) && cEnd > pEnd + EPS) {
        violations.push({ child: span.spanID, parent: parent.spanID, kind: "child_extends_past_parent", cEnd, pEnd });
      }
    }
  }
  const report = {
    specVersion: "och-trace-temporal-v1",
    tracePath,
    ok: violations.length === 0,
    violations,
  };
  writeFileSync(join(BENCH, "trace-temporal-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (violations.length) console.error("trace-temporal-invariants: violations:\n", JSON.stringify(violations, null, 2));
  else console.error("trace-temporal-invariants: OK");
  process.exit(0);
}

main();
