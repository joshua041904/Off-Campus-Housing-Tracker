#!/usr/bin/env node
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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { runDir: "" };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--run-dir") out.runDir = args[i + 1] || "", i += 1;
    else if (!a.startsWith("--") && !out.runDir) out.runDir = a;
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const args = parseArgs();
  if (!args.runDir) {
    console.error("Missing --run-dir");
    process.exit(1);
  }
  const runDir = path.resolve(args.runDir);
  const resultsPath = path.join(runDir, "results.csv");
  if (!fs.existsSync(resultsPath)) {
    console.error(`Missing results.csv in run dir: ${runDir}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(resultsPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    console.error(`No rows in results.csv: ${resultsPath}`);
    process.exit(1);
  }
  const header = splitCsv(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ["service", "protocol", "vus"];
  for (const k of required) {
    if (!(k in idx)) {
      console.error(`results.csv missing column: ${k}`);
      process.exit(1);
    }
  }

  const rows = lines.slice(1).map((ln) => {
    const r = splitCsv(ln);
    return Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
  });
  const protoOrder = { http3: 0, http2: 1, http1: 2 };
  const toVus = (r) => {
    const n = Number(r.vus);
    return Number.isFinite(n) ? n : 0;
  };

  const outBase = path.join(runDir, "combined-10");
  const servicesBase = path.join(outBase, "services");
  ensureDir(servicesBase);

  const byService = new Map();
  for (const r of rows) {
    const s = r.service || "unknown";
    if (!byService.has(s)) byService.set(s, []);
    byService.get(s).push(r);
  }

  for (const [service, sRows] of [...byService.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const svcDir = path.join(servicesBase, service);
    ensureDir(svcDir);
    const out = path.join(svcDir, `${service}-protocols-vu-combined.csv`);
    const sorted = [...sRows].sort((a, b) => {
      const pa = protoOrder[a.protocol] ?? 99;
      const pb = protoOrder[b.protocol] ?? 99;
      if (pa !== pb) return pa - pb;
      return toVus(a) - toVus(b);
    });
    const linesOut = [header.join(",")];
    for (const r of sorted) {
      linesOut.push(header.map((h) => {
        const v = r[h] ?? "";
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(","));
    }
    fs.writeFileSync(out, `${linesOut.join("\n")}\n`, "utf8");
  }

  const allOut = path.join(outBase, "ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv");
  const allSorted = [...rows].sort((a, b) => {
    const sa = a.service.localeCompare(b.service);
    if (sa !== 0) return sa;
    const pa = protoOrder[a.protocol] ?? 99;
    const pb = protoOrder[b.protocol] ?? 99;
    if (pa !== pb) return pa - pb;
    return toVus(a) - toVus(b);
  });
  const allLines = [header.join(",")];
  for (const r of allSorted) {
    allLines.push(header.map((h) => {
      const v = r[h] ?? "";
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(","));
  }
  fs.writeFileSync(allOut, `${allLines.join("\n")}\n`, "utf8");

  console.log(`Wrote ${outBase}`);
  console.log(`Service files: ${byService.size}`);
  console.log(`All-services file: ${allOut}`);
}

main();
