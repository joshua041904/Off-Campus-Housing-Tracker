#!/usr/bin/env node
/**
 * Merge everything under bench_logs/performance-lab/ into exactly 10 handoff files
 * (no content dropped — JSON/Markdown merged or copied in full).
 *
 * Output directory (default): <perf-dir>/PERF_LAB_CANONICAL_10/
 *
 *   node scripts/perf/bundle-performance-lab-10.js [--perf-dir DIR] [--out-subdir NAME]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs() {
  const out = { perfDir: "", outSubdir: "PERF_LAB_CANONICAL_10" };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--perf-dir") out.perfDir = path.resolve(a[++i] || "");
    else if (a[i] === "--out-subdir") out.outSubdir = a[++i] || out.outSubdir;
  }
  return out;
}

function readJsonIf(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readTextIf(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function writeOut(outDir, name, body, isBinary) {
  const p = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });
  if (isBinary) {
    fs.writeFileSync(p, body);
  } else if (typeof body === "string") {
    fs.writeFileSync(p, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  } else {
    fs.writeFileSync(p, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
  return p;
}

function main() {
  const args = parseArgs();
  const repoRoot = path.resolve(__dirname, "../..");
  const perfDir = args.perfDir || path.join(repoRoot, "bench_logs", "performance-lab");
  const outDir = path.join(perfDir, args.outSubdir);

  if (!fs.existsSync(perfDir)) {
    console.error(`Missing perf dir: ${perfDir}`);
    process.exit(1);
  }

  const missing = [];
  const takeJson = (rel) => {
    const p = path.join(perfDir, rel);
    const j = readJsonIf(p);
    if (j == null) missing.push(rel);
    return j;
  };
  const takeMd = (rel) => {
    const p = path.join(perfDir, rel);
    const t = readTextIf(p);
    if (t == null) missing.push(rel);
    return t;
  };

  const capacityRecommendations = takeJson("capacity-recommendations.json");
  const capacitySchema = takeJson("capacity-dashboard-schema.json");
  const serviceClassification = takeJson("service-classification.json");
  const finalClassification = takeJson("final-classification.json");
  const perServiceBest = takeJson("per-service-best-protocol.json");
  const serviceModels = takeJson("service-models.json");
  const protocolMerit = takeJson("protocol-merit.json");
  const collapseSummary = takeJson("collapse-summary.json");
  const happinessMatrix = takeJson("protocol-happiness-matrix.json");
  const superiorityScores = takeJson("protocol-superiority-scores.json");
  const envelopeDashboard = takeJson("envelope-dashboard.json");
  const heatmap = takeJson("transport-dominance-heatmap.json");

  const ingressMd = takeMd("ingress-tuning.md");
  const reportMd = takeMd("performance-lab-report.md");
  const rankingMd = takeMd("protocol-ranking.md");

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];

  written.push(
    writeOut(outDir, "02-capacity.json", {
      capacity_recommendations: capacityRecommendations,
      capacity_dashboard_schema: capacitySchema,
    }),
  );

  written.push(
    writeOut(
      outDir,
      "03-ingress-tuning.md",
      ingressMd != null ? ingressMd : "",
      false,
    ),
  );

  written.push(
    writeOut(outDir, "04-classification.json", {
      service_classification: serviceClassification,
      final_classification: finalClassification,
      per_service_best_protocol: perServiceBest,
    }),
  );

  written.push(
    writeOut(outDir, "05-models-merit-collapse.json", {
      service_models: serviceModels,
      protocol_merit: protocolMerit,
      collapse_summary: collapseSummary,
    }),
  );

  written.push(
    writeOut(
      outDir,
      "06-performance-lab-report.md",
      reportMd != null ? reportMd : "",
      false,
    ),
  );

  written.push(
    writeOut(outDir, "07-protocol-scores.json", {
      protocol_happiness_matrix: happinessMatrix,
      protocol_superiority_scores: superiorityScores,
    }),
  );

  written.push(
    writeOut(
      outDir,
      "08-protocol-ranking.md",
      rankingMd != null ? rankingMd : "",
      false,
    ),
  );

  written.push(
    writeOut(
      outDir,
      "09-envelope-dashboard.json",
      envelopeDashboard != null ? envelopeDashboard : null,
    ),
  );

  written.push(
    writeOut(outDir, "10-transport-dominance-heatmap.json", heatmap != null ? heatmap : null),
  );

  const dataFiles = written.filter((p) => path.basename(p) !== "01-manifest.json");
  const manifest = {
    bundle_schema: "perf-lab-canonical-10-v1",
    generated_at: new Date().toISOString(),
    perf_dir: perfDir,
    output_dir: outDir,
    missing_source_files: missing.length ? missing : undefined,
    note: "Files 02–10 are full merges or verbatim copies of performance-lab artifacts (no truncation). This manifest lists sha256 only for 02–10 (not for 01).",
    files: dataFiles.map((p) => {
      const base = path.basename(p);
      return {
        name: base,
        sha256: sha256File(p),
        bytes: fs.statSync(p).size,
      };
    }),
  };
  fs.writeFileSync(path.join(outDir, "01-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Wrote 10-file bundle under ${outDir}`);
  for (const f of manifest.files) {
    console.log(`  ${f.name}  ${f.bytes} bytes  sha256=${f.sha256.slice(0, 12)}…`);
  }
  if (missing.length) console.log(`Note: missing sources (empty/null in bundle): ${missing.join(", ")}`);
}

main();
