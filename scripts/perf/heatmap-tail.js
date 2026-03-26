#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function color(v) {
  if (!Number.isFinite(v)) return "#ddd";
  if (v > 8) return "#7f0000";
  if (v > 5) return "#c62828";
  if (v > 3) return "#ef6c00";
  return "#2e7d32";
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const modelPath = path.join(repoRoot, "bench_logs", "service-model.json");
  if (!fs.existsSync(modelPath)) {
    console.error("service-model.json not found. Run make model first.");
    process.exit(1);
  }
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  const outDir = path.join(repoRoot, "bench_logs", "graphs");
  fs.mkdirSync(outDir, { recursive: true });
  const services = model.services || [];
  const rowH = 28;
  let y = 24;
  const rows = [];
  for (const s of services) {
    const best = (s.protocols || []).find((p) => p.protocol === s.best_protocol) || (s.protocols || [])[0];
    const ratio = best?.tail_ratio_p95_over_p50;
    rows.push(`<text x="10" y="${y+18}" font-size="12" font-family="Arial">${s.service}</text><rect x="190" y="${y}" width="160" height="20" fill="${color(Number(ratio))}" /><text x="360" y="${y+15}" font-size="12" font-family="Arial">${Number(ratio||0).toFixed(2)}</text>`);
    y += rowH;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${y+10}"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="16" font-size="14" font-family="Arial">Tail Amplification Heatmap (best protocol per service)</text>${rows.join("")}</svg>`;
  const out = path.join(outDir, "tail-heatmap.svg");
  fs.writeFileSync(out, svg);
  console.log(`Wrote ${out}`);
}

main();
