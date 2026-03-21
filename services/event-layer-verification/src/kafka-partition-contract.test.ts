/**
 * Repo contract: event topics default to 6 partitions (scripts/create-kafka-event-topics.sh).
 * Keeps k6 / load / ordering assumptions aligned with Kafka setup.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

describe("Kafka event topic contract", () => {
  it("create-kafka-event-topics.sh defaults PARTITIONS to 6", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const scriptPath = path.join(repoRoot, "scripts", "create-kafka-event-topics.sh");
    const text = readFileSync(scriptPath, "utf8");
    expect(text).toContain("PARTITIONS:-6");
  });
});
