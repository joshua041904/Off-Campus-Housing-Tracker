#!/usr/bin/env node
/**
 * CI / release gate: read a checked-in or exported uptime summary and fail if availability
 * is below the 99.5% SLO target.
 *
 * Usage (repo root):
 *   node scripts/slo/check-error-budget.js
 *
 * Env:
 *   UPTIME_SUMMARY_FILE — path to JSON (default: bench_logs/uptime-summary.json)
 *   OCH_SLO_TARGET      — decimal availability target (default: 0.995)
 *   SKIP_SLO_POLICY_CHECK — set to 1 to no-op (local only)
 *
 * JSON shape:
 *   { "<service>": { "availability_percent": 99.6 }, ... }
 *   or { "services": { ... } }  (nested form also accepted)
 */
const fs = require("fs");
const path = require("path");

const SLO_TARGET = Number(process.env.OCH_SLO_TARGET || "0.995");
const BUDGET = 1 - SLO_TARGET;

if (process.env.SKIP_SLO_POLICY_CHECK === "1") {
  console.log("SKIP_SLO_POLICY_CHECK=1 — skipping SLO policy check.");
  process.exit(0);
}

const uptimeFile = path.resolve(
  process.cwd(),
  process.env.UPTIME_SUMMARY_FILE || path.join("bench_logs", "uptime-summary.json")
);

if (!fs.existsSync(uptimeFile)) {
  console.error(`Missing uptime summary: ${uptimeFile}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(uptimeFile, "utf8"));
const data = raw.services && typeof raw.services === "object" ? raw.services : raw;

let failed = false;

for (const service of Object.keys(data)) {
  if (service.startsWith("_")) continue;
  const row = data[service];
  if (!row || typeof row.availability_percent !== "number") {
    console.error(`Invalid entry for ${service}: expected { availability_percent: number }`);
    failed = true;
    continue;
  }

  const availability = row.availability_percent / 100;
  const errorShare = 1 - availability;
  const budgetUsedVsMonthly = errorShare / BUDGET;

  if (availability < SLO_TARGET) {
    console.error(
      `SLO violation: ${service} availability ${(availability * 100).toFixed(3)}% < ${(SLO_TARGET * 100).toFixed(1)}%`
    );
    failed = true;
  }

  console.log(
    `${service}: availability=${(availability * 100).toFixed(3)}% error_share=${(errorShare * 100).toFixed(4)}% ` +
      `budget_consumed≈${(budgetUsedVsMonthly * 100).toFixed(1)}% of monthly error budget (request-based model)`
  );
}

if (failed) {
  console.error("Error budget / SLO gate failed.");
  process.exit(1);
}

console.log("SLO policy check passed.");
process.exit(0);
