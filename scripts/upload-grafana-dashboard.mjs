#!/usr/bin/env node
/**
 * POST a Grafana dashboard JSON to Grafana HTTP API (dashboards/db).
 *
 * Required env:
 *   GRAFANA_URL — base URL, e.g. https://grafana.example.com
 *   GRAFANA_API_KEY or GRAFANA_SERVICE_ACCOUNT_TOKEN — Bearer token
 *
 * Optional:
 *   BOOTSTRAP_GRAFANA_DASHBOARD_OUT — dashboard JSON path (default: bench_logs/bootstrap_grafana_dashboard.json)
 *   GRAFANA_FOLDER_ID — numeric folder id (omit for General)
 *   GRAFANA_UPLOAD_MESSAGE — commit message string
 *
 * CLI: node scripts/upload-grafana-dashboard.mjs [path-to-dashboard.json]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

async function main() {
  const baseRaw = (process.env.GRAFANA_URL || "").trim().replace(/\/+$/, "");
  if (!baseRaw) throw new Error("GRAFANA_URL is required (e.g. https://grafana.my.org)");
  const base = baseRaw;
  const token = (process.env.GRAFANA_API_KEY || process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || "").trim();
  if (!token) throw new Error("GRAFANA_API_KEY or GRAFANA_SERVICE_ACCOUNT_TOKEN is required");

  const file =
    process.argv[2] ||
    process.env.BOOTSTRAP_GRAFANA_DASHBOARD_OUT ||
    join(repoRoot, "bench_logs/bootstrap_grafana_dashboard.json");
  const raw = readFileSync(file, "utf8");
  const dashboard = JSON.parse(raw);

  const payload = {
    dashboard,
    overwrite: true,
    message: process.env.GRAFANA_UPLOAD_MESSAGE || "upload via scripts/upload-grafana-dashboard.mjs",
  };
  const fid = process.env.GRAFANA_FOLDER_ID;
  if (fid !== undefined && fid !== "" && !Number.isNaN(Number.parseInt(String(fid), 10))) {
    payload.folderId = Number.parseInt(String(fid), 10);
  }

  const res = await fetch(`${base}/api/dashboards/db`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = { raw: bodyText };
  }
  if (!res.ok) {
    console.error("Grafana API error:", res.status, json);
    process.exit(1);
  }
  console.log(JSON.stringify({ status: res.status, ...json }, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
