import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo root when this package is at tools/kafka-contract/{src,dist} (three levels below root).
 */
export function resolveOchRepoRoot(moduleUrl: string): string {
  const dir = path.dirname(fileURLToPath(moduleUrl));
  return path.resolve(dir, "../../..");
}

/**
 * Proto events dir: KAFKA_CONTRACT_PROTO_ROOT (absolute) wins; else PROTO_ROOT relative to repo (default proto/events).
 */
export function resolveProtoEventsDir(repoRoot: string): string {
  const override = process.env.KAFKA_CONTRACT_PROTO_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.resolve(repoRoot, process.env.PROTO_ROOT ?? "proto/events");
}

/**
 * Basenames of proto/events/*.proto (excluding envelope.proto), sorted.
 */
export function scanProtoEvents(protoRoot: string): string[] {
  if (!fs.existsSync(protoRoot)) {
    throw new Error(`Proto root not found: ${protoRoot}`);
  }
  return fs
    .readdirSync(protoRoot)
    .filter((f) => f.endsWith(".proto") && f !== "envelope.proto")
    .map((f) => path.basename(f, ".proto"))
    .sort((a, b) => a.localeCompare(b));
}
