#!/usr/bin/env node
/**
 * For services with transport_gain_tau < 0, HTTP/3 is not a transport win — prefer HTTP/2 as default
 * for edge→gateway→upstream routing decisions (avoids chasing H3 unlock where geometry says H2).
 *
 * Writes transport-default-hints.json (and optional copy for k8s config dir).
 *
 *   node scripts/protocol/build-transport-default-hints.js [--perf-dir DIR] [--out PATH]
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { perfDir: "", outPath: "", alsoK8s: false };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") out.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--out") out.outPath = path.resolve(a[++i] || "");
    else if (a[i] === "--also-k8s") out.alsoK8s = true;
  }
  return out;
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const matrixPath = path.join(perfDir, "protocol-happiness-matrix.json");
  const defaultOut = path.join(perfDir, "transport-default-hints.json");
  const outPath = args.outPath || defaultOut;

  if (!fs.existsSync(matrixPath)) {
    console.error(`build-transport-default-hints: missing ${matrixPath}`);
    process.exit(1);
  }

  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  const rows = matrix.rows || [];
  const preferH2 = [];
  const h3Ok = [];

  for (const row of rows) {
    const service = row.service;
    const tau = Number(row.transport_gain_tau);
    if (!service || !Number.isFinite(tau)) continue;
    const entry = {
      service,
      transport_gain_tau: tau,
      h3_transport_unlocked: Boolean(row.h3_transport_unlocked),
      winner: row.winner || null,
      hint: tau < 0 ? "prefer_http2_default" : "h3_may_be_worthwhile",
    };
    if (tau < 0) preferH2.push(entry);
    else h3Ok.push(entry);
  }

  preferH2.sort((a, b) => a.service.localeCompare(b.service));
  h3Ok.sort((a, b) => a.service.localeCompare(b.service));

  const doc = {
    generated_at: new Date().toISOString(),
    note: "Services with tau < 0: do not prioritize HTTP/3 as default; use HTTP/2 unless product requires QUIC.",
    prefer_http2_default: preferH2,
    non_negative_tau: h3Ok,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath} (${preferH2.length} prefer-H2, ${h3Ok.length} tau>=0)`);

  if (args.alsoK8s) {
    const k8sPath = path.join(repoRoot, "infra", "k8s", "base", "config", "transport-routing-defaults.json");
    const slim = {
      version: 1,
      generated_at: doc.generated_at,
      note: doc.note,
      prefer_http2_default_for_services: preferH2.map((x) => x.service),
    };
    fs.mkdirSync(path.dirname(k8sPath), { recursive: true });
    fs.writeFileSync(k8sPath, `${JSON.stringify(slim, null, 2)}\n`, "utf8");
    console.log(`Wrote ${k8sPath}`);
  }
}

main();
