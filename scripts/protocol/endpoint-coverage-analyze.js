#!/usr/bin/env node
/**
 * Best-effort route inventory vs test references (integration / e2e / k6).
 * Outputs bench_logs/performance-lab/endpoint-coverage-report.json (or --out).
 *
 *   node scripts/protocol/endpoint-coverage-analyze.js [--repo-root DIR] [--out PATH] [--fail-if-untested]
 *
 * This is heuristic (Express/Fastify-style registration strings); tune patterns as routes evolve.
 */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { repoRoot: "", out: "", failIfUntested: false };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--repo-root") o.repoRoot = path.resolve(a[++i] || "");
    else if (a[i] === "--out") o.out = path.resolve(a[++i] || "");
    else if (a[i] === "--fail-if-untested") o.failIfUntested = true;
  }
  return o;
}

function walkFiles(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
      walkFiles(p, pred, acc);
    } else if (pred(p)) acc.push(p);
  }
  return acc;
}

const ROUTE_RE = /\b(?:app|router|r)\.(?:get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi;
const METHOD_PATH_RE =
  /\{\s*method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*pattern:\s*\/(\^)?([^/]+)/gi;

function extractFromText(text, file) {
  const found = new Set();
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    const r = m[1];
    if (r.startsWith("/") && !r.includes("${")) found.add(`ANY ${r}`);
  }
  METHOD_PATH_RE.lastIndex = 0;
  while ((m = METHOD_PATH_RE.exec(text)) !== null) {
    const method = m[1];
    const raw = m[3];
    const simplified = raw.replace(/\\\//g, "/").replace(/\^|\$|\?|\*|\+|\|/g, "").split("/").filter(Boolean);
    if (simplified.length) found.add(`${method} /${simplified.join("/")}`);
  }
  return [...found];
}

function loadTestCorpus(repoRoot) {
  const roots = [
    path.join(repoRoot, "services"),
    path.join(repoRoot, "webapp"),
    path.join(repoRoot, "scripts/load"),
  ];
  const files = [];
  for (const r of roots) {
    walkFiles(
      r,
      (p) =>
        /\.(test|spec)\.(t|j)sx?$/.test(p) ||
        /\/integration\//.test(p) ||
        /\/e2e\//.test(p) ||
        /k6.*\.js$/.test(path.basename(p)),
      files,
    );
  }
  let blob = "";
  for (const f of files.slice(0, 400)) {
    try {
      blob += fs.readFileSync(f, "utf8");
    } catch {
      /* ignore */
    }
  }
  return blob;
}

function main() {
  const args = parseArgs();
  const repoRoot = args.repoRoot || path.resolve(__dirname, "../..");
  const out =
    args.out || path.join(repoRoot, "bench_logs", "performance-lab", "endpoint-coverage-report.json");

  const gatewayServer = path.join(repoRoot, "services", "api-gateway", "src", "server.ts");
  const serviceSrc = path.join(repoRoot, "services");
  const routeFiles = walkFiles(
    serviceSrc,
    (p) =>
      /\/src\/.*\.(ts|js)$/.test(p) &&
      !/node_modules/.test(p) &&
      (p.includes("routes") || p.includes("server.ts") || p.includes("router")),
    [],
  ).slice(0, 120);

  const routes = new Set();
  if (fs.existsSync(gatewayServer)) {
    const t = fs.readFileSync(gatewayServer, "utf8");
    for (const r of extractFromText(t, gatewayServer)) routes.add(r);
  }
  for (const f of routeFiles) {
    const t = fs.readFileSync(f, "utf8");
    for (const r of extractFromText(t, f)) routes.add(r);
  }

  const testBlob = loadTestCorpus(repoRoot);
  const routeList = [...routes].sort();
  const untested = [];
  const tested = [];
  for (const r of routeList) {
    const tail = r.replace(/^ANY |^(GET|POST|PUT|PATCH|DELETE) /, "").split(" ")[0] || r;
    const needle = tail.replace(/^\//, "");
    if (needle.length < 3) continue;
    if (testBlob.includes(tail) || testBlob.includes(needle)) tested.push(r);
    else untested.push(r);
  }

  const byService = {
    "api-gateway": {
      total_routes: routeList.length,
      tested_routes: tested.length,
      untested_routes: untested,
      note: "Aggregated heuristic across gateway + service route files; not per-handler granularity.",
    },
  };

  const doc = {
    generated_at: new Date().toISOString(),
    fail_if_untested: args.failIfUntested,
    services: byService,
    all_untested_count: untested.length,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${out} (${untested.length} possibly-untested heuristic routes)`);

  if (args.failIfUntested && untested.length > 0) {
    console.error("FAIL: untested routes > 0 (heuristic). Set --fail-if-untested off for advisory mode.");
    process.exit(1);
  }
}

main();
