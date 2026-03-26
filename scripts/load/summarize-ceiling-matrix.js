#!/usr/bin/env node
/**
 * Build clear side-by-side CSVs from run-service-ceiling results.csv.
 *
 * Outputs in same directory as input CSV:
 *   - protocol-side-by-side.csv
 *   - protocol-anomalies.csv
 *
 * Usage:
 *   node scripts/load/summarize-ceiling-matrix.js bench_logs/ceiling/<stamp>/results.csv
 */
const fs = require("fs");
const path = require("path");

function splitCsv(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error("usage: node scripts/load/summarize-ceiling-matrix.js <results.csv>");
    process.exit(1);
  }
  const csvPath = path.resolve(inPath);
  if (!fs.existsSync(csvPath)) {
    console.error(`results.csv not found: ${csvPath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    console.error(`results.csv empty: ${csvPath}`);
    process.exit(1);
  }
  const header = splitCsv(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ["service", "protocol", "vus", "p95_waiting_ms", "rps", "fail_rate", "collapse", "reason"];
  for (const k of required) {
    if (!(k in idx)) {
      console.error(`results.csv missing required column: ${k}`);
      process.exit(1);
    }
  }

  const rows = lines.slice(1).map((line) => {
    const c = splitCsv(line);
    const o = {};
    for (const [k, i] of Object.entries(idx)) o[k] = c[i] ?? "";
    return o;
  });

  const byServiceProtocol = new Map();
  const collapseByServiceProtocol = new Map();
  const vusByService = new Map();
  for (const r of rows) {
    const s = r.service;
    const p = r.protocol;
    const vus = num(r.vus);
    if (!vusByService.has(s)) vusByService.set(s, []);
    vusByService.get(s).push(vus);
    const k = `${s}::${p}`;
    if (!byServiceProtocol.has(k) || (vus != null && vus < num(byServiceProtocol.get(k).vus))) {
      byServiceProtocol.set(k, r); // baseline row (lowest vus)
    }
    if (r.collapse === "1") {
      const prev = collapseByServiceProtocol.get(k);
      if (prev == null || (vus != null && vus < prev)) collapseByServiceProtocol.set(k, vus);
    }
  }

  const outDir = path.dirname(csvPath);
  const sideBySidePath = path.join(outDir, "protocol-side-by-side.csv");
  const anomaliesPath = path.join(outDir, "protocol-anomalies.csv");

  const services = [...new Set(rows.map((r) => r.service))].sort();
  const protocols = ["http3", "http2", "http1"];

  const sideHeader = [
    "service",
    "baseline_vus",
    "http3_p95_ms", "http3_rps", "http3_fail_rate", "http3_collapse", "http3_first_collapse_vus",
    "http2_p95_ms", "http2_rps", "http2_fail_rate", "http2_collapse", "http2_first_collapse_vus",
    "http1_p95_ms", "http1_rps", "http1_fail_rate", "http1_collapse", "http1_first_collapse_vus",
    "best_protocol_by_p95_at_baseline",
    "off_signal",
    "off_reason",
  ];
  const sideLines = [sideHeader.join(",")];
  const anomalyLines = [["service", "protocol", "vus", "p95_ms", "rps", "fail_rate", "collapse", "reason", "severity", "why"].join(",")];

  for (const s of services) {
    const baselineVus = Math.min(...(vusByService.get(s).filter((v) => Number.isFinite(v))));
    const cells = {};
    for (const p of protocols) {
      const row = byServiceProtocol.get(`${s}::${p}`);
      cells[p] = row || null;
    }

    let bestProto = "";
    let bestP95 = Infinity;
    for (const p of protocols) {
      const p95 = num(cells[p]?.p95_waiting_ms);
      const fail = num(cells[p]?.fail_rate) ?? 0;
      if (p95 == null) continue;
      if (fail > 0.05) continue;
      if (p95 < bestP95) {
        bestP95 = p95;
        bestProto = p;
      }
    }
    if (!bestProto) {
      for (const p of protocols) {
        const p95 = num(cells[p]?.p95_waiting_ms);
        if (p95 != null && p95 < bestP95) {
          bestP95 = p95;
          bestProto = p;
        }
      }
    }

    const offReasons = [];
    for (const p of protocols) {
      const row = cells[p];
      if (!row) {
        offReasons.push(`${p}:missing`);
        continue;
      }
      const p95 = num(row.p95_waiting_ms);
      const fail = num(row.fail_rate) ?? 0;
      if (row.collapse === "1") offReasons.push(`${p}:collapse@baseline`);
      if (p95 != null && p95 >= 1000) offReasons.push(`${p}:p95>=1000`);
      if (fail >= 0.01) offReasons.push(`${p}:fail>=1%`);

      if (row.collapse === "1" || (p95 != null && p95 >= 1000) || fail >= 0.01) {
        const sev = fail >= 0.05 ? "high" : "medium";
        anomalyLines.push([
          s, p, row.vus, row.p95_waiting_ms, row.rps, row.fail_rate, row.collapse, row.reason,
          sev, row.reason || "collapse/latency/fail threshold crossed",
        ].map(csvEscape).join(","));
      }
    }

    const sideRow = [
      s,
      Number.isFinite(baselineVus) ? baselineVus : "",
      cells.http3?.p95_waiting_ms ?? "", cells.http3?.rps ?? "", cells.http3?.fail_rate ?? "", cells.http3?.collapse ?? "", collapseByServiceProtocol.get(`${s}::http3`) ?? "",
      cells.http2?.p95_waiting_ms ?? "", cells.http2?.rps ?? "", cells.http2?.fail_rate ?? "", cells.http2?.collapse ?? "", collapseByServiceProtocol.get(`${s}::http2`) ?? "",
      cells.http1?.p95_waiting_ms ?? "", cells.http1?.rps ?? "", cells.http1?.fail_rate ?? "", cells.http1?.collapse ?? "", collapseByServiceProtocol.get(`${s}::http1`) ?? "",
      bestProto,
      offReasons.length > 0 ? "1" : "0",
      offReasons.join("|"),
    ];
    sideLines.push(sideRow.map(csvEscape).join(","));
  }

  fs.writeFileSync(sideBySidePath, sideLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(anomaliesPath, anomalyLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${sideBySidePath}`);
  console.log(`Wrote ${anomaliesPath}`);
}

main();
