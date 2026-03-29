#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function latestCeiling(repoRoot) {
  const base = path.join(repoRoot, "bench_logs", "ceiling");
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).map((n) => path.join(base, n)).filter((p) => fs.existsSync(path.join(p, "results.csv")));
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || null;
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const fmtArg = process.argv.includes("--format") ? process.argv[process.argv.indexOf("--format") + 1] : "md";
  const dir = latestCeiling(repoRoot);
  if (!dir) {
    console.error("No ceiling run found.");
    process.exit(1);
  }
  const side = path.join(dir, "protocol-side-by-side.csv");
  const anom = path.join(dir, "protocol-anomalies.csv");
  const model = path.join(dir, "service-model.json");
  const outMd = path.join(repoRoot, "bench_logs", "performance-report.md");
  const outHtml = path.join(repoRoot, "bench_logs", "performance-report.html");
  const summary = [
    `# Performance Report`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Latest ceiling run: \`${dir}\``,
    ``,
    `Artifacts:`,
    `- \`${side}\``,
    `- \`${anom}\``,
    `- \`${model}\``,
    `- \`${path.join(dir, "global-collapse-summary.json")}\``,
    ``,
  ].join("\n");
  if (fmtArg === "html") {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Performance Report</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:980px;margin:24px auto;line-height:1.45}code{background:#f3f3f3;padding:2px 4px;border-radius:4px}</style></head><body><pre>${summary.replace(/</g, "&lt;")}</pre></body></html>`;
    fs.writeFileSync(outHtml, html);
    console.log(`Wrote ${outHtml}`);
  } else {
    fs.writeFileSync(outMd, summary);
    console.log(`Wrote ${outMd}`);
  }
}

main();
