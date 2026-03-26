#!/usr/bin/env node
/**
 * Walk latest bench_logs run-* protocol-matrix folder (or PROTOCOL_MATRIX_DIR) and emit
 * bench_logs/protocol-comparison.csv — tail latency + RPS + fail rate + waiting/sending p95.
 *
 * HTTP/3 summaries often use http3_req_duration instead of http_req_duration.
 *
 * Usage (repo root):
 *   node scripts/perf/extract-protocol-matrix.js
 *   PROTOCOL_MATRIX_DIR=/path/to/protocol-matrix node scripts/perf/extract-protocol-matrix.js
 *   PROTOCOL_COMPARISON_CSV=/path/out.csv — override output (default: bench_logs/protocol-comparison.csv)
 */
const fs = require("fs");
const path = require("path");

function pickTrend(values) {
  if (!values || typeof values !== "object") return {};
  const get = (k) => (values[k] != null ? String(values[k]) : "");
  return {
    med: get("med"),
    avg: get("avg"),
    max: get("max"),
    p95: get("p(95)"),
    p99: get("p(99)"),
  };
}

function trendFromMetric(m) {
  if (!m) return null;
  if (m.values && typeof m.values === "object") return pickTrend(m.values);
  return pickTrend(m);
}

function durationBlock(data, proto) {
  const metrics = data.metrics || {};
  const h3 = trendFromMetric(metrics.http3_req_duration || metrics["http3_req_duration"]);
  const h1 = trendFromMetric(metrics.http_req_duration || metrics["http_req_duration"]);
  if (proto === "http3" && h3 && (h3.p95 || h3.med)) {
    return { metric: "http3_req_duration", ...h3 };
  }
  if (h1 && (h1.p95 || h1.med)) {
    return { metric: "http_req_duration", ...h1 };
  }
  if (h3) return { metric: "http3_req_duration", ...h3 };
  return { metric: "", med: "", avg: "", max: "", p95: "", p99: "" };
}

function rateMetric(metrics, name) {
  const m = metrics[name];
  if (!m) return "";
  const v = m.values && m.values.rate != null ? m.values.rate : m.rate;
  return v != null ? String(v) : "";
}

function waitingSendingP95(metrics, proto) {
  const w =
    trendFromMetric(metrics.http_req_waiting || metrics["http_req_waiting"]) ||
    trendFromMetric(metrics.http3_req_waiting || metrics["http3_req_waiting"]);
  const s =
    trendFromMetric(metrics.http_req_sending || metrics["http_req_sending"]) ||
    trendFromMetric(metrics.http3_req_sending || metrics["http3_req_sending"]);
  return {
    waiting_p95: w && w.p95 ? w.p95 : "",
    sending_p95: s && s.p95 ? s.p95 : "",
  };
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function findLatestProtocolMatrix(repoRoot) {
  const envDir = process.env.PROTOCOL_MATRIX_DIR;
  if (envDir && fs.existsSync(envDir)) {
    return path.resolve(envDir);
  }
  const bench = path.join(repoRoot, "bench_logs");
  if (!fs.existsSync(bench)) return null;
  let best = null;
  let bestM = 0;
  for (const name of fs.readdirSync(bench)) {
    if (!/^run-\d{8}-\d{6}$/.test(name)) continue;
    const pm = path.join(bench, name, "protocol-matrix");
    if (!fs.existsSync(pm) || !fs.statSync(pm).isDirectory()) continue;
    const st = fs.statSync(pm);
    if (st.mtimeMs >= bestM) {
      bestM = st.mtimeMs;
      best = pm;
    }
  }
  return best;
}

function csvEscape(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const pm = findLatestProtocolMatrix(repoRoot);
  if (!pm) {
    console.error("No protocol-matrix directory found under bench_logs/run-*/protocol-matrix");
    process.exit(1);
  }

  const rows = [];
  const protos = ["http1", "http2", "http3"];
  for (const proto of protos) {
    const dir = path.join(pm, proto);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith("-summary.json")) continue;
      const fp = path.join(dir, name);
      const data = loadJson(fp);
      if (!data || data.error) continue;
      const service = name.replace(/-summary\.json$/, "");
      const dur = durationBlock(data, proto);
      const metrics = data.metrics || {};
      const rps = rateMetric(metrics, "http_reqs") || rateMetric(metrics, "http3_reqs");
      const fail = rateMetric(metrics, "http_req_failed");
      const ws = waitingSendingP95(metrics, proto);
      const protoCsv = proto === "http1" ? "http1.1" : proto;
      rows.push({
        service,
        protocol: protoCsv,
        p50: dur.med,
        p95: dur.p95,
        p99: dur.p99,
        max: dur.max,
        avg: dur.avg,
        rps,
        fail_rate: fail,
        duration_metric: dur.metric,
        waiting_p95: ws.waiting_p95,
        sending_p95: ws.sending_p95,
        source: path.relative(repoRoot, fp),
      });
    }
  }

  const outPath = process.env.PROTOCOL_COMPARISON_CSV
    ? path.resolve(process.env.PROTOCOL_COMPARISON_CSV)
    : path.join(repoRoot, "bench_logs", "protocol-comparison.csv");
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const header = [
    "service",
    "protocol",
    "p50",
    "p95",
    "p99",
    "max",
    "avg",
    "rps",
    "fail_rate",
    "duration_metric",
    "waiting_p95",
    "sending_p95",
    "source_summary",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.service,
        r.protocol,
        r.p50,
        r.p95,
        r.p99,
        r.max,
        r.avg,
        r.rps,
        r.fail_rate,
        r.duration_metric,
        r.waiting_p95,
        r.sending_p95,
        r.source,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outPath} (${rows.length} rows) from ${pm}`);
}

main();
