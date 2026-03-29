#!/usr/bin/env node
/**
 * Deploy freeze gate: query Prometheus for firing OCHCriticalBurnRate alerts.
 *
 * Usage:
 *   PROM_URL=http://prometheus.observability.svc:9090 node scripts/slo/check-burn-rate.js
 *
 * Env:
 *   PROM_URL — required unless SKIP_DEPLOY_FREEZE_CHECK=1
 *   SKIP_DEPLOY_FREEZE_CHECK — 1: exit 0 (CI without cluster / local dev)
 */
const PROM_URL = (process.env.PROM_URL || "").replace(/\/$/, "");

if (process.env.SKIP_DEPLOY_FREEZE_CHECK === "1") {
  console.log("SKIP_DEPLOY_FREEZE_CHECK=1 — skipping deploy freeze check.");
  process.exit(0);
}

if (!PROM_URL) {
  console.log("PROM_URL unset — skipping deploy freeze check (no Prometheus in this context).");
  process.exit(0);
}

const QUERY = 'sum(ALERTS{alertname="OCHCriticalBurnRate",alertstate="firing"})';

async function run() {
  const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(QUERY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Prometheus query failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const json = await res.json();
  if (json.status !== "success") {
    console.error("Unexpected Prometheus response:", JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }
  const v = json.data?.result?.[0]?.value?.[1];
  const firing = parseFloat(v || "0");
  if (firing > 0) {
    console.error("Critical SLO burn alert firing — deploy freeze engaged.");
    process.exit(1);
  }
  console.log("No critical burn alerts firing — deploy allowed.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
