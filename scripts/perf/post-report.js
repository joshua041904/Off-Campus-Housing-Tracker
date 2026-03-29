#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : "";
  };
  return { webhook: get("--webhook") };
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode || 0));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const { webhook } = parseArgs();
  if (!webhook) {
    console.error("Usage: node scripts/perf/post-report.js --webhook <url>");
    process.exit(1);
  }
  const repoRoot = path.resolve(__dirname, "../..");
  const mdPath = path.join(repoRoot, "bench_logs", "performance-report.md");
  const text = fs.existsSync(mdPath)
    ? fs.readFileSync(mdPath, "utf8").slice(0, 3500)
    : `Performance report missing at ${mdPath}`;
  const payload = { text };
  const code = await postJson(webhook, payload);
  if (code < 200 || code >= 300) {
    console.error(`Webhook post failed: HTTP ${code}`);
    process.exit(1);
  }
  console.log(`Posted performance report (HTTP ${code}).`);
}

main().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
