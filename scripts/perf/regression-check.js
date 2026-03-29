#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : "";
  };
  return { baseline: get("--baseline"), candidate: get("--candidate"), threshold: Number(get("--threshold") || "0.15") };
}

function p95(runDir, proto, svc) {
  const fp = path.resolve(runDir, "protocol-matrix", proto, `${svc}-summary.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(fp, "utf8"));
    const m = d.metrics || {};
    const w = m.http_req_waiting || m.http3_req_waiting || m.http_req_duration || m.http3_req_duration || {};
    const v = Number(w["p(95)"] || 0);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function main() {
  const { baseline, candidate, threshold } = parseArgs();
  if (!baseline || !candidate) {
    console.error("Usage: node scripts/perf/regression-check.js --baseline <run> --candidate <run> --threshold 0.15");
    process.exit(1);
  }
  const services = ["trust","messaging","listings","booking","auth","gateway","analytics","media","event-layer"];
  const protos = ["http3","http2","http1"];
  const offenders = [];
  for (const s of services) {
    for (const p of protos) {
      const b = p95(baseline, p, s);
      const c = p95(candidate, p, s);
      if (b == null || c == null) continue;
      const delta = (c - b) / b;
      if (delta > threshold) offenders.push({ service: s, protocol: p, baseline: b, candidate: c, delta });
    }
  }
  if (offenders.length) {
    console.error(`Regression guard failed: ${offenders.length} p95 regressions > ${(threshold * 100).toFixed(1)}%`);
    for (const o of offenders) {
      console.error(` - ${o.service}/${o.protocol}: ${o.baseline.toFixed(2)} -> ${o.candidate.toFixed(2)} (${(o.delta*100).toFixed(2)}%)`);
    }
    process.exit(1);
  }
  console.log(`Regression guard passed (threshold ${(threshold * 100).toFixed(1)}%).`);
}

main();
