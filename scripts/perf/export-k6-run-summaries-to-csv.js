#!/usr/bin/env node
/**
 * Collect k6 --summary-export JSON files under a bench_logs run-* folder into clean CSVs.
 *
 * Usage (repo root):
 *   node scripts/perf/export-k6-run-summaries-to-csv.js bench_logs/run-20260327-222137
 *   K6_EXPORT_RUN_DIR=bench_logs/run-20260327-222137 node scripts/perf/export-k6-run-summaries-to-csv.js
 *
 * Writes:
 *   <runDir>/k6-runs-summary.csv              — all k6 summary rows (clean master)
 *   <runDir>/k6-csv-parts/01-part.csv … 10-part.csv — same rows split across 10 files (header in each)
 */
const fs = require("fs");
const path = require("path");

function csvEscape(s) {
  if (s == null || s === "") return "";
  const t = String(s);
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function trend(m) {
  if (!m || typeof m !== "object") return {};
  return {
    avg: m.avg ?? "",
    min: m.min ?? "",
    med: m.med ?? "",
    max: m.max ?? "",
    p90: m["p(90)"] ?? "",
    p95: m["p(95)"] ?? "",
    p99: m["p(99)"] ?? "",
  };
}

function pickDurationMetrics(metrics) {
  const h1 = metrics.http_req_duration || metrics["http_req_duration"];
  const h3 = metrics.http3_req_duration || metrics["http3_req_duration"];
  if (h1 && (h1.med != null || h1["p(95)"] != null)) return { key: "http_req_duration", ...trend(h1) };
  if (h3 && (h3.med != null || h3["p(95)"] != null)) return { key: "http3_req_duration", ...trend(h3) };
  return { key: "", avg: "", min: "", med: "", max: "", p90: "", p95: "", p99: "" };
}

function rowFromSummary(runDir, absPath, data) {
  const rel = path.relative(runDir, absPath).split(path.sep).join("/");
  const base = path.basename(absPath, ".json");
  const slug = base.replace(/-summary$/, "");
  let category = "other";
  if (rel.includes("protocol-matrix/")) {
    const m = rel.match(/protocol-matrix\/([^/]+)\//);
    category = m ? `protocol-matrix-${m[1]}` : "protocol-matrix";
  } else if (rel.includes("phase-d/") && rel.includes("k6-cross-service-isolation")) {
    category = "phase-d-k6-cross-service-isolation";
  } else if (rel.includes("phase-d/")) {
    category = "phase-d";
  }

  const metrics = data.metrics || {};
  const httpReqs = metrics.http_reqs || {};
  const iters = metrics.iterations || {};
  const failed = metrics.http_req_failed || {};
  const checks = metrics.checks || {};
  const dur = pickDurationMetrics(metrics);
  const wait = trend(metrics.http_req_waiting || metrics.http3_req_waiting);
  const vus = metrics.vus_max || metrics.vus || {};

  const checksPasses = checks.passes != null ? checks.passes : "";
  const checksFails = checks.fails != null ? checks.fails : "";

  return {
    relative_path: rel,
    category,
    script_slug: slug,
    duration_metric: dur.key,
    http_reqs_count: httpReqs.count != null ? httpReqs.count : "",
    http_reqs_rps: httpReqs.rate != null ? Number(httpReqs.rate).toFixed(4) : "",
    http_req_failed_rate: failed.value != null ? String(failed.value) : "",
    duration_ms_med: dur.med,
    duration_ms_avg: dur.avg,
    duration_ms_p90: dur.p90,
    duration_ms_p95: dur.p95,
    duration_ms_p99: dur.p99,
    duration_ms_max: dur.max,
    http_req_waiting_p95_ms: wait.p95,
    iterations_count: iters.count != null ? iters.count : "",
    iterations_rps: iters.rate != null ? Number(iters.rate).toFixed(4) : "",
    vus_max: vus.value != null ? vus.value : vus.max != null ? vus.max : "",
    checks_passes: checksPasses,
    checks_fails: checksFails,
  };
}

const COLUMNS = [
  "relative_path",
  "category",
  "script_slug",
  "duration_metric",
  "http_reqs_count",
  "http_reqs_rps",
  "http_req_failed_rate",
  "duration_ms_med",
  "duration_ms_avg",
  "duration_ms_p90",
  "duration_ms_p95",
  "duration_ms_p99",
  "duration_ms_max",
  "http_req_waiting_p95_ms",
  "iterations_count",
  "iterations_rps",
  "vus_max",
  "checks_passes",
  "checks_fails",
];

function rowToLine(r) {
  return COLUMNS.map((c) => csvEscape(r[c])).join(",");
}

function walkSummaries(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkSummaries(p, out);
    else if (name.endsWith("-summary.json") || name.endsWith("summary.json")) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const data = JSON.parse(raw);
        if (data && data.metrics) out.push({ path: p, data });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  let runDir = process.env.K6_EXPORT_RUN_DIR || process.argv[2];
  if (!runDir) {
    console.error("Usage: node export-k6-run-summaries-to-csv.js <bench_logs/run-YYYYMMDD-HHMMSS>");
    process.exit(1);
  }
  runDir = path.isAbsolute(runDir) ? runDir : path.join(repoRoot, runDir);
  if (!fs.existsSync(runDir)) {
    console.error("Run dir not found:", runDir);
    process.exit(1);
  }

  const found = walkSummaries(runDir);
  const k6Only = found.filter(
    (f) =>
      f.path.includes(`${path.sep}protocol-matrix${path.sep}`) ||
      f.path.includes("k6-cross-service-isolation") ||
      f.path.includes(`${path.sep}k6${path.sep}`)
  );
  const use = k6Only.length > 0 ? k6Only : found;

  const rows = use
    .map(({ path: p, data }) => rowFromSummary(runDir, p, data))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  const partsDir = path.join(runDir, "k6-csv-parts");
  fs.mkdirSync(partsDir, { recursive: true });

  const header = COLUMNS.join(",");
  const lines = rows.map(rowToLine);
  const masterPath = path.join(runDir, "k6-runs-summary.csv");
  fs.writeFileSync(masterPath, [header, ...lines].join("\n") + "\n", "utf8");

  const numParts = 10;
  const n = rows.length;
  for (let part = 0; part < numParts; part += 1) {
    const start = Math.floor((part * n) / numParts);
    const end = Math.floor(((part + 1) * n) / numParts);
    const chunk = lines.slice(start, end);
    const partPath = path.join(partsDir, `${String(part + 1).padStart(2, "0")}-part.csv`);
    fs.writeFileSync(partPath, [header, ...chunk].join("\n") + "\n", "utf8");
  }

  console.log(`Wrote ${rows.length} k6 summary rows → ${masterPath}`);
  console.log(`Parts: ${partsDir}/01-part.csv … 10-part.csv`);
}

main();
