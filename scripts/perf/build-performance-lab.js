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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(a) {
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
  return Math.sqrt(v);
}

function median(a) {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { input: "", outDir: "", pools: [10, 20, 30, 40] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--input") out.input = args[i + 1] || "", i += 1;
    else if (a === "--out-dir") out.outDir = args[i + 1] || "", i += 1;
    else if (a === "--pools") {
      out.pools = (args[i + 1] || "10,20,30,40")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      i += 1;
    } else if (!a.startsWith("--") && !out.input) out.input = a;
  }
  return out;
}

function loadRows(csvPath) {
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`CSV has no data: ${csvPath}`);
  const header = splitCsv(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = [
    "service", "protocol", "vus", "p50_waiting_ms", "p95_waiting_ms", "avg_waiting_ms",
    "max_waiting_ms", "rps", "fail_rate", "collapse", "reason", "pg_peak_connections",
  ];
  for (const k of required) if (!(k in idx)) throw new Error(`Missing CSV column: ${k}`);
  return lines.slice(1).map((ln) => {
    const r = splitCsv(ln);
    return {
      service: r[idx.service],
      protocol: r[idx.protocol],
      vus: num(r[idx.vus]) ?? 0,
      p50: num(r[idx.p50_waiting_ms]),
      p95: num(r[idx.p95_waiting_ms]),
      avg: num(r[idx.avg_waiting_ms]),
      max: num(r[idx.max_waiting_ms]),
      rps: num(r[idx.rps]) ?? 0,
      failRate: num(r[idx.fail_rate]) ?? 0,
      collapse: String(r[idx.collapse] || "0") === "1",
      reason: r[idx.reason] || "",
      pgPeak: num(r[idx.pg_peak_connections]),
    };
  });
}

function firstCollapse(rows) {
  const c = rows.filter((r) => r.collapse).sort((a, b) => a.vus - b.vus);
  return c[0] || null;
}

function preCollapse(rows) {
  const fc = firstCollapse(rows);
  return fc ? rows.filter((r) => r.vus < fc.vus) : rows;
}

function maxRps(rows) {
  return rows.reduce((m, r) => Math.max(m, r.rps || 0), 0);
}

function firstConsistentStart(values, threshold, isGood, minConsecutive = 2) {
  for (let i = 0; i < values.length - (minConsecutive - 1); i += 1) {
    let ok = true;
    for (let j = 0; j < minConsecutive; j += 1) {
      if (!isGood(values[i + j], threshold)) ok = false;
    }
    if (ok) return values[i].vus;
  }
  return null;
}

function build(rows, pools) {
  const byService = new Map();
  for (const r of rows) {
    if (!byService.has(r.service)) byService.set(r.service, []);
    byService.get(r.service).push(r);
  }

  const collapseSummary = {};
  const bestProtocol = {};
  const classification = {};
  const merit = {};
  const serviceModels = {};

  for (const [service, sRows] of [...byService.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const byProto = new Map();
    for (const r of sRows) {
      if (!byProto.has(r.protocol)) byProto.set(r.protocol, []);
      byProto.get(r.protocol).push(r);
    }
    for (const arr of byProto.values()) arr.sort((a, b) => a.vus - b.vus);

    const perProto = {};
    const collapseVusList = [];
    const maxPreByProto = {};
    const pgAll = [];
    for (const [proto, arr] of byProto.entries()) {
      const fc = firstCollapse(arr);
      if (fc) collapseVusList.push(fc.vus);
      const pre = preCollapse(arr);
      const maxPre = maxRps(pre.length ? pre : arr);
      maxPreByProto[proto] = maxPre;
      for (const r of arr) if (r.pgPeak != null) pgAll.push(r.pgPeak);
      perProto[proto] = {
        collapse_vus: fc ? fc.vus : null,
        collapse_reason: fc ? fc.reason : "none",
        max_rps_pre_collapse: maxPre,
      };
    }

    const best = Object.entries(maxPreByProto).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    bestProtocol[service] = { service, best_protocol: best };
    collapseSummary[service] = { service, protocols: perProto };

    const vusSet = [...new Set(sRows.map((r) => r.vus))].sort((a, b) => a - b);
    const protoList = [...byProto.keys()].sort();
    const cv = [];
    for (const vus of vusSet) {
      const vals = [];
      for (const p of protoList) {
        const row = byProto.get(p).find((x) => x.vus === vus);
        if (row) vals.push(row.rps);
      }
      if (vals.length >= 2) {
        const m = mean(vals);
        if (m && m > 0) cv.push(stddev(vals) / m);
      }
    }
    const protocolVariance = mean(cv) || 0;
    const collapseSpread = collapseVusList.length ? Math.max(...collapseVusList) - Math.min(...collapseVusList) : 0;
    const globalMaxPre = Math.max(...Object.values(maxPreByProto), 0);

    let cls = "BACKEND_BOUND";
    const tailEarly = sRows.some((r) => r.vus <= 30 && r.p50 && r.p95 && r.p50 > 0 && (r.p95 / r.p50) >= 5);
    if (tailEarly && globalMaxPre <= 40) cls = "FANOUT_AMPLIFIED";
    else if (globalMaxPre <= 30 && protocolVariance < 0.12) cls = "CPU_BOUND";
    else if (protocolVariance >= 0.2 || collapseSpread >= 20) cls = "TRANSPORT_SENSITIVE";
    else cls = "BACKEND_BOUND";

    const medPg = median(pgAll.filter((x) => x != null));
    const dbBound = cls === "BACKEND_BOUND" || (medPg != null && medPg >= 8);
    const finalClass = dbBound && cls === "TRANSPORT_SENSITIVE"
      ? "DB_POOL_LIMITED_TRANSPORT_SENSITIVE"
      : dbBound ? "DB_POOL_LIMITED" : cls;

    classification[service] = {
      service,
      classification: finalClass,
      best_protocol: best,
      best_protocol_max_rps_pre_collapse: maxPreByProto[best] || 0,
      collapse_spread_vus: collapseSpread,
      protocol_rps_variance_cv: Number(protocolVariance.toFixed(4)),
    };

    const meritByProtocol = {};
    const comparisons = [["http3", "http2"], ["http2", "http1"], ["http3", "http1"]];
    for (const p of protoList) {
      meritByProtocol[p] = {
        throughput_merit_from_vus: null,
        latency_merit_from_vus: null,
        stability_merit: false,
        avg_throughput_advantage_percent: null,
        avg_p95_improvement_percent: null,
      };
    }
    for (const [a, b] of comparisons) {
      if (!byProto.has(a) || !byProto.has(b)) continue;
      const candidates = [];
      for (const vus of vusSet) {
        const ra = byProto.get(a).find((x) => x.vus === vus);
        const rb = byProto.get(b).find((x) => x.vus === vus);
        if (!ra || !rb || ra.collapse || rb.collapse) continue;
        const dRps = rb.rps > 0 ? ((ra.rps - rb.rps) / rb.rps) * 100 : 0;
        const dP95 = rb.p95 > 0 ? ((rb.p95 - ra.p95) / rb.p95) * 100 : 0;
        candidates.push({ vus, dRps, dP95 });
      }
      const rpsStart = firstConsistentStart(candidates, 10, (v, t) => v.dRps > t);
      const p95Start = firstConsistentStart(candidates, 15, (v, t) => v.dP95 > t);
      if (rpsStart != null) {
        const cur = meritByProtocol[a].throughput_merit_from_vus;
        meritByProtocol[a].throughput_merit_from_vus = cur == null ? rpsStart : Math.min(cur, rpsStart);
      }
      if (p95Start != null) {
        const cur = meritByProtocol[a].latency_merit_from_vus;
        meritByProtocol[a].latency_merit_from_vus = cur == null ? p95Start : Math.min(cur, p95Start);
      }
      const rpsVals = candidates.filter((x) => x.dRps > 0).map((x) => x.dRps);
      const p95Vals = candidates.filter((x) => x.dP95 > 0).map((x) => x.dP95);
      if (rpsVals.length) meritByProtocol[a].avg_throughput_advantage_percent = Number(mean(rpsVals).toFixed(2));
      if (p95Vals.length) meritByProtocol[a].avg_p95_improvement_percent = Number(mean(p95Vals).toFixed(2));
      const ca = perProto[a]?.collapse_vus ?? Infinity;
      const cb = perProto[b]?.collapse_vus ?? Infinity;
      if (ca > cb) meritByProtocol[a].stability_merit = true;
    }
    merit[service] = { service, merit: meritByProtocol };

    const bestRows = (byProto.get(best) || []).filter((r) => !r.collapse);
    const anchor = bestRows.length ? bestRows[bestRows.length - 1] : (byProto.get(best) || [])[0];
    if (anchor && anchor.avg && anchor.avg > 0) {
      const wAvgSec = anchor.avg / 1000;
      const mu = 1 / wAvgSec;
      const util = {};
      const safeByPool = {};
      for (const p of pools) {
        util[p] = Number((anchor.rps / (p * mu)).toFixed(4));
        safeByPool[p] = Number((0.8 * p * mu).toFixed(2));
      }
      const curr20 = (byProto.get(best) || []).find((r) => r.vus === 20)?.rps ?? null;
      const safeRps = Number((0.8 * (maxPreByProto[best] || 0)).toFixed(2));
      serviceModels[service] = {
        service,
        classification: finalClass,
        modeled_protocol: best,
        max_rps_pre_collapse: Number((maxPreByProto[best] || 0).toFixed(2)),
        safe_rps: safeRps,
        current_rps_at_vus_20: curr20,
        headroom_rps: curr20 != null ? Number((safeRps - curr20).toFixed(2)) : null,
        avg_waiting_ms_anchor: anchor.avg,
        mu_estimated_rps_per_slot: Number(mu.toFixed(4)),
        utilization_by_pool: util,
        predicted_safe_rps_by_pool: safeByPool,
      };
    }
  }

  return { classification, bestProtocol, collapseSummary, merit, serviceModels };
}

function reportMarkdown(data, sourceCsv) {
  const services = Object.keys(data.classification).sort();
  const lines = [];
  lines.push("# Performance Lab Report");
  lines.push("");
  lines.push(`Source CSV: \`${sourceCsv}\``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Service Classification");
  lines.push("");
  lines.push("| Service | Classification | Best Protocol | Collapse (h3/h2/h1) |");
  lines.push("|---|---|---|---|");
  for (const s of services) {
    const c = data.classification[s];
    const p = data.collapseSummary[s].protocols;
    const cv = `${p.http3?.collapse_vus ?? "none"}/${p.http2?.collapse_vus ?? "none"}/${p.http1?.collapse_vus ?? "none"}`;
    lines.push(`| ${s} | ${c.classification} | ${c.best_protocol} | ${cv} |`);
  }
  lines.push("");
  lines.push("## Protocol Merit");
  lines.push("");
  lines.push("| Service | Protocol | Throughput Merit From VUS | Latency Merit From VUS | Stability Merit | Avg Throughput Adv % | Avg p95 Improve % |");
  lines.push("|---|---|---:|---:|---|---:|---:|");
  for (const s of services) {
    const m = data.merit[s].merit;
    for (const p of ["http3", "http2", "http1"]) {
      if (!m[p]) continue;
      lines.push(`| ${s} | ${p} | ${m[p].throughput_merit_from_vus ?? ""} | ${m[p].latency_merit_from_vus ?? ""} | ${m[p].stability_merit ? "yes" : "no"} | ${m[p].avg_throughput_advantage_percent ?? ""} | ${m[p].avg_p95_improvement_percent ?? ""} |`);
    }
  }
  lines.push("");
  lines.push("## DB-Bound Service Models");
  lines.push("");
  lines.push("| Service | Protocol | Max RPS Pre-Collapse | Safe RPS (0.8x) | RPS@VUS20 | Headroom RPS |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const s of Object.keys(data.serviceModels).sort()) {
    const x = data.serviceModels[s];
    lines.push(`| ${s} | ${x.modeled_protocol} | ${x.max_rps_pre_collapse} | ${x.safe_rps} | ${x.current_rps_at_vus_20 ?? ""} | ${x.headroom_rps ?? ""} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const input = args.input
    ? path.resolve(args.input)
    : path.join(repoRoot, "bench_logs", "ceiling", "latest", "combined-10", "ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv");
  if (!fs.existsSync(input)) {
    console.error(`Input CSV not found: ${input}`);
    process.exit(1);
  }
  const outDir = args.outDir ? path.resolve(args.outDir) : path.join(repoRoot, "bench_logs", "performance-lab");
  const rows = loadRows(input);
  const data = build(rows, args.pools);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "service-classification.json"), JSON.stringify(Object.values(data.classification), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "per-service-best-protocol.json"), JSON.stringify(Object.values(data.bestProtocol), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "collapse-summary.json"), JSON.stringify(Object.values(data.collapseSummary), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "protocol-merit.json"), JSON.stringify(Object.values(data.merit), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "service-models.json"), JSON.stringify(Object.values(data.serviceModels), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "final-classification.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    source_csv: input,
    services: Object.values(data.classification),
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "performance-lab-report.md"), reportMarkdown(data, input), "utf8");
  console.log(`Wrote performance lab outputs to ${outDir}`);
}

main();
