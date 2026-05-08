#!/usr/bin/env node
/**
 * Placeholder: Trace ↔ DB row consistency (spec §5.2).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const strict = process.env.STEP7_REQUIRE_DB_ROW === "1";
const out = {
  specVersion: "och-observability-integrity-spec-v1",
  gate: "db-row-invariant",
  status: strict ? "FAIL" : "SKIPPED",
  reason: strict
    ? "STEP7_REQUIRE_DB_ROW=1 but validator not implemented"
    : "set STEP7_REQUIRE_DB_ROW=1 to enforce (optional)",
  timestamp: new Date().toISOString(),
};

const dir = process.env.STEP7_REPORT_DIR || join(process.cwd(), "bench_logs/step7-observability");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "db-row-invariant.json"), `${JSON.stringify(out, null, 2)}\n`);
if (strict) {
  console.error(out.reason);
  process.exit(1);
}
console.log("db-row-invariant: skipped (optional gate)");
