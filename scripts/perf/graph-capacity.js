#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

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
  for (const s of model.services || []) {
    const best = (s.protocols || [])[0];
    if (!best) continue;
    const pools = Object.keys(best.predicted_safe_rps_by_pool || {});
    const points = pools.map((p) => ({ p: Number(p), rps: Number(best.predicted_safe_rps_by_pool[p] || 0) }));
    const maxR = Math.max(1, ...points.map((x) => x.rps));
    const width = 700, height = 280, left = 60, top = 20, w = 600, h = 220;
    const poly = points.map((x, i) => {
      const px = left + ((x.p - points[0].p) / Math.max(1, (points[points.length - 1].p - points[0].p))) * w;
      const py = top + h - (x.rps / maxR) * h;
      return `${px},${py}`;
    }).join(" ");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="18" font-size="14" font-family="Arial">Capacity Curve: ${s.service}</text><line x1="${left}" y1="${top+h}" x2="${left+w}" y2="${top+h}" stroke="#222"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top+h}" stroke="#222"/><polyline fill="none" stroke="#1463ff" stroke-width="2" points="${poly}"/></svg>`;
    fs.writeFileSync(path.join(outDir, `${s.service}-capacity.svg`), svg);
  }
  console.log(`Wrote capacity SVGs under ${outDir}`);
}

main();
