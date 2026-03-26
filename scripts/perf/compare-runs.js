#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : "";
  };
  return { run1: get("--run1"), run2: get("--run2") };
}

function loadSummary(runDir, proto, service) {
  const p = path.resolve(runDir, "protocol-matrix", proto, `${service}-summary.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    const m = d.metrics || {};
    const wait = m.http_req_waiting || m.http3_req_waiting || m.http_req_duration || m.http3_req_duration || {};
    return {
      p95: Number(wait["p(95)"] || 0),
      rps: Number((m.http_reqs && m.http_reqs.rate) || (m.http3_reqs && m.http3_reqs.rate) || 0),
      fail: Number((m.http_req_failed && m.http_req_failed.value) || 0),
    };
  } catch {
    return null;
  }
}

function main() {
  const { run1, run2 } = parseArgs();
  if (!run1 || !run2) {
    console.error("Usage: node scripts/perf/compare-runs.js --run1 <dir> --run2 <dir>");
    process.exit(1);
  }
  const services = ["trust","messaging","listings","booking","auth","gateway","analytics","media","event-layer"];
  const protos = ["http3", "http2", "http1"];
  const rows = [];
  for (const s of services) {
    for (const p of protos) {
      const a = loadSummary(run1, p, s);
      const b = loadSummary(run2, p, s);
      if (!a || !b) continue;
      rows.push({
        service: s,
        protocol: p,
        p95_delta_pct: a.p95 > 0 ? (b.p95 - a.p95) / a.p95 : 0,
        rps_delta_pct: a.rps > 0 ? (b.rps - a.rps) / a.rps : 0,
        fail_delta: b.fail - a.fail,
      });
    }
  }
  const outJson = path.resolve("bench_logs/run-diff-summary.json");
  const outMd = path.resolve("bench_logs/run-diff-report.md");
  fs.writeFileSync(outJson, JSON.stringify({ run1, run2, rows }, null, 2) + "\n");
  const md = [
    `# Run Diff Report`,
    ``,
    `- run1: \`${run1}\``,
    `- run2: \`${run2}\``,
    ``,
    `| service | protocol | p95 delta % | rps delta % | fail delta |`,
    `|---|---:|---:|---:|---:|`,
    ...rows.map((r) => `| ${r.service} | ${r.protocol} | ${(r.p95_delta_pct*100).toFixed(2)} | ${(r.rps_delta_pct*100).toFixed(2)} | ${r.fail_delta.toFixed(6)} |`),
    ``,
  ].join("\n");
  fs.writeFileSync(outMd, md);
  console.log(`Wrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
}

main();
