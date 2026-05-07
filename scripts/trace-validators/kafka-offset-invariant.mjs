#!/usr/bin/env node
/**
 * Placeholder: Trace ↔ Kafka offset correlation (spec §5.1).
 * Set STEP7_REQUIRE_KAFKA_OFFSET=1 and implement broker admin read to enable.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const strict = process.env.STEP7_REQUIRE_KAFKA_OFFSET === "1";
const out = {
  specVersion: "och-observability-integrity-spec-v1",
  gate: "kafka-offset-invariant",
  status: strict ? "FAIL" : "SKIPPED",
  reason: strict
    ? "STEP7_REQUIRE_KAFKA_OFFSET=1 but validator not implemented (needs broker admin API wiring)"
    : "set STEP7_REQUIRE_KAFKA_OFFSET=1 to enforce (optional)",
  timestamp: new Date().toISOString(),
};

const dir = process.env.STEP7_REPORT_DIR || join(process.cwd(), "bench_logs/step7-observability");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "kafka-offset-invariant.json"), `${JSON.stringify(out, null, 2)}\n`);
if (strict) {
  console.error(out.reason);
  process.exit(1);
}
console.log("kafka-offset-invariant: skipped (optional gate)");
