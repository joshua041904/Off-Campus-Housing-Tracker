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
 *
 * When no bench_logs run directory contains protocol-matrix (e.g. run was flattened), set
 *   EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1
 * to rebuild rows + anomalies from an existing protocol-comparison.csv (must include
 * service, protocol, p95; other columns optional).
 *
 * HTTP2_COLLAPSE_THRESHOLD — optional positive number (default 3). Anomaly when http2_p95 > threshold × http1_p95.
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

/** Minimal RFC4180-style line parse (handles quoted fields). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Rebuild row objects from a prior protocol-comparison.csv when summary JSON is gone.
 */
function rowsFromProtocolComparisonCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const si = idx("service");
  const pi = idx("protocol");
  const p95i = idx("p95");
  if (si < 0 || pi < 0 || p95i < 0) return [];

  const pick = (cells, name) => {
    const i = idx(name);
    return i >= 0 ? cells[i] : "";
  };

  const rows = [];
  for (let li = 1; li < lines.length; li += 1) {
    const cells = parseCsvLine(lines[li]);
    if (cells.length < header.length && cells.every((c) => c === "")) continue;
    const service = cells[si];
    const protocol = cells[pi];
    if (!service || !protocol) continue;
    rows.push({
      service,
      protocol,
      p50: pick(cells, "p50"),
      p95: cells[p95i],
      p99: pick(cells, "p99"),
      max: pick(cells, "max"),
      avg: pick(cells, "avg"),
      rps: pick(cells, "rps"),
      fail_rate: pick(cells, "fail_rate"),
      duration_metric: pick(cells, "duration_metric"),
      waiting_p95: pick(cells, "waiting_p95"),
      sending_p95: pick(cells, "sending_p95"),
      source: pick(cells, "source_summary") || path.relative(path.dirname(csvPath), csvPath),
    });
  }
  return rows;
}

function csvEscape(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** k6 trend p95 may be numeric string or "12.3ms" */
function parseP95Ms(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/ms\s*$/i, "").replace(/,/g, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Default multiplier: HTTP/2 p95 must exceed this × HTTP/1.1 p95 to count as collapse anomaly. */
function http2CollapseThreshold() {
  const raw = process.env.HTTP2_COLLAPSE_THRESHOLD;
  if (raw == null || String(raw).trim() === "") return 3;
  const n = parseFloat(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * If HTTP/2 p95 > threshold × HTTP/1.1 p95 for the same service → collapse / multiplexing anomaly (heuristic).
 * Threshold: HTTP2_COLLAPSE_THRESHOLD (default 3). CI may set 5 for noisy matrix CSVs.
 * Writes bench_logs/performance-lab/protocol-matrix-anomalies.json and merges into
 * bench_logs/transport-lab/protocol-integrity-report.json when present.
 */
function computeHttp2CollapseAnomalies(rows, repoRoot) {
  const mult = http2CollapseThreshold();
  const byService = new Map();
  for (const r of rows) {
    if (!byService.has(r.service)) byService.set(r.service, {});
    const slot = byService.get(r.service);
    const p = parseP95Ms(r.p95);
    const proto = String(r.protocol || "");
    if (proto === "http1.1" || proto === "http1") slot.http1_p95_ms = p;
    if (proto === "http2") slot.http2_p95_ms = p;
  }

  const by_service = {};
  let any_http2_collapse_anomaly = false;
  for (const [svc, slot] of byService) {
    const h1 = slot.http1_p95_ms;
    const h2 = slot.http2_p95_ms;
    const http2_anomaly =
      h1 != null && h2 != null && h1 > 0 && h2 > h1 * mult;
    if (http2_anomaly) any_http2_collapse_anomaly = true;
    by_service[svc] = {
      http2_anomaly: http2_anomaly,
      http1_p95_ms: h1,
      http2_p95_ms: h2,
      ratio_h2_over_h1:
        h1 != null && h1 > 0 && h2 != null ? Math.round((h2 / h1) * 10000) / 10000 : null,
    };
  }

  for (const r of rows) {
    const info = by_service[r.service];
    const proto = String(r.protocol || "");
    r.http2_collapse_anomaly =
      proto === "http2" && info && info.http2_anomaly ? "true" : "";
  }

  const doc = {
    generated_at: new Date().toISOString(),
    rule: `http2_p95_ms > ${mult} * http1_p95_ms (same service, protocol matrix; HTTP2_COLLAPSE_THRESHOLD)`,
    http2_collapse_threshold: mult,
    any_http2_collapse_anomaly,
    by_service,
  };

  const perfLab = path.join(repoRoot, "bench_logs", "performance-lab");
  if (!fs.existsSync(perfLab)) fs.mkdirSync(perfLab, { recursive: true });
  const anomalyPath = path.join(perfLab, "protocol-matrix-anomalies.json");
  fs.writeFileSync(anomalyPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${anomalyPath}`);

  const integrityPath = path.join(repoRoot, "bench_logs", "transport-lab", "protocol-integrity-report.json");
  if (fs.existsSync(integrityPath)) {
    try {
      const integ = JSON.parse(fs.readFileSync(integrityPath, "utf8"));
      integ.matrix_http2_collapse = doc;
      integ.any_http2_collapse_anomaly = any_http2_collapse_anomaly;
      fs.writeFileSync(integrityPath, `${JSON.stringify(integ, null, 2)}\n`, "utf8");
      console.log(`Merged matrix HTTP/2 collapse hints into ${integrityPath}`);
    } catch (e) {
      console.warn(`Could not merge anomalies into protocol-integrity-report.json: ${e?.message || e}`);
    }
  }

  return doc;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const outPath = process.env.PROTOCOL_COMPARISON_CSV
    ? path.resolve(process.env.PROTOCOL_COMPARISON_CSV)
    : path.join(repoRoot, "bench_logs", "protocol-comparison.csv");
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const pm = findLatestProtocolMatrix(repoRoot);
  let rows = [];
  let sourceLabel = pm;

  if (pm) {
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
  } else if (
    process.env.EXTRACT_PROTOCOL_MATRIX_FROM_CSV === "1" &&
    fs.existsSync(outPath)
  ) {
    rows = rowsFromProtocolComparisonCsv(outPath);
    sourceLabel = `${outPath} (EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1)`;
    console.warn(
      "No protocol-matrix under latest bench_logs run; rebuilding rows from existing CSV (EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1)",
    );
  }

  if (!rows.length) {
    if (!pm) {
      console.error(
        "No protocol-matrix directory found under bench_logs run-* directories",
      );
      console.error(
        "To regenerate from bench_logs/protocol-comparison.csv: EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1 node scripts/perf/extract-protocol-matrix.js",
      );
    } else {
      console.error(`No summary rows under ${pm}`);
    }
    process.exit(1);
  }

  computeHttp2CollapseAnomalies(rows, repoRoot);

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
    "http2_collapse_anomaly",
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
        r.http2_collapse_anomaly || "",
        r.source,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outPath} (${rows.length} rows) from ${sourceLabel}`);
}

main();
