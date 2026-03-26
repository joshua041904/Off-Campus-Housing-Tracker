#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function splitCsv(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function latestResults(repoRoot) {
  const base = path.join(repoRoot, "bench_logs", "ceiling");
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .map((n) => path.join(base, n))
    .filter((p) => fs.existsSync(path.join(p, "results.csv")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ? path.join(dirs[0], "results.csv") : null;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : latestResults(repoRoot);
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error("No results.csv found (pass path explicitly).");
    process.exit(1);
  }
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  const hdr = splitCsv(lines[0]);
  const idx = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const rows = lines.slice(1).map((l) => {
    const c = splitCsv(l);
    const o = {};
    for (const [k, i] of Object.entries(idx)) o[k] = c[i] ?? "";
    return o;
  });
  const first = new Map();
  const best = new Map();
  for (const r of rows) {
    const key = `${r.service}::${r.protocol}`;
    if (r.collapse === "1") {
      const v = num(r.vus);
      if (v != null && (!first.has(key) || v < first.get(key).vus)) first.set(key, { vus: v, reason: r.reason });
    }
    const p95 = num(r.p95_waiting_ms);
    if (p95 == null) continue;
    const bs = best.get(r.service);
    if (!bs || p95 < bs.p95) best.set(r.service, { protocol: r.protocol, p95, fail: num(r.fail_rate) || 0 });
  }
  const services = [...new Set(rows.map((r) => r.service))].sort();
  const summary = {
    source: csvPath,
    generated_at: new Date().toISOString(),
    services: services.map((s) => ({
      service: s,
      best_protocol: best.get(s)?.protocol || "",
      best_p95_ms: best.get(s)?.p95 ?? null,
      first_collapse: {
        http3: first.get(`${s}::http3`) || null,
        http2: first.get(`${s}::http2`) || null,
        http1: first.get(`${s}::http1`) || null,
      },
    })),
  };
  const outDir = path.join(path.dirname(csvPath));
  const jsonPath = path.join(outDir, "global-collapse-summary.json");
  const mdPath = path.join(outDir, "global-collapse-summary.md");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + "\n");
  const md = [
    "# Global Collapse Summary",
    "",
    `Source: \`${csvPath}\``,
    "",
    "| Service | Best Protocol | Best p95 (ms) | First collapse http3 | First collapse http2 | First collapse http1 |",
    "|---|---:|---:|---:|---:|---:|",
    ...summary.services.map((s) => `| ${s.service} | ${s.best_protocol || "-"} | ${s.best_p95_ms ?? "-"} | ${s.first_collapse.http3?.vus ?? "-"} | ${s.first_collapse.http2?.vus ?? "-"} | ${s.first_collapse.http1?.vus ?? "-"} |`),
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, md);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main();
