#!/usr/bin/env node
/**
 * Soft check: G.app_runtime exists in invariant graph and infra/app_runtime_services.json is non-empty.
 * Usage: node scripts/validate-runtime-config.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const graph = JSON.parse(readFileSync(join(root, "infra/bootstrap_invariants.graph.json"), "utf8"));
const cfgPath = join(root, "infra/app_runtime_services.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

if (!graph.nodes?.["G.app_runtime"]) {
  console.error("validate-runtime-config: graph missing node G.app_runtime");
  process.exit(1);
}
if (!Array.isArray(cfg.services) || cfg.services.length === 0) {
  console.error("validate-runtime-config: no services in infra/app_runtime_services.json");
  process.exit(1);
}
const allNames = new Set(cfg.services.map((s) => s?.name).filter(Boolean));
function topoValid(services) {
  const names = [...allNames];
  const deps = Object.fromEntries(names.map((n) => [n, []]));
  for (const s of services) {
    if (!s?.name) continue;
    const raw = s.depends_on;
    deps[s.name] = Array.isArray(raw) ? raw.map(String) : [];
  }
  const indeg = Object.fromEntries(names.map((n) => [n, 0]));
  const adj = Object.fromEntries(names.map((n) => [n, []]));
  for (const n of names) {
    for (const d of deps[n]) {
      if (!allNames.has(d)) continue;
      adj[d].push(n);
      indeg[n] += 1;
    }
  }
  const q = names.filter((n) => indeg[n] === 0);
  const ind2 = { ...indeg };
  let seen = 0;
  while (q.length) {
    const u = q.shift();
    seen += 1;
    for (const v of adj[u] || []) {
      ind2[v] -= 1;
      if (ind2[v] === 0) q.push(v);
    }
  }
  return seen === names.length;
}
for (const s of cfg.services) {
  if (!s?.name) {
    console.error(`validate-runtime-config: invalid service entry: ${JSON.stringify(s)}`);
    process.exit(1);
  }
  const rawDeps = s.depends_on;
  if (rawDeps != null && !Array.isArray(rawDeps)) {
    console.error(`validate-runtime-config: depends_on must be an array: ${JSON.stringify(s)}`);
    process.exit(1);
  }
  for (const d of rawDeps || []) {
    if (typeof d !== "string" || !allNames.has(d)) {
      console.error(`validate-runtime-config: depends_on unknown or invalid dep ${JSON.stringify(d)} in ${s.name}`);
      process.exit(1);
    }
  }
  const ht = s.health_type || "http";
  if (ht === "grpc") {
    if (typeof s.grpc_port !== "number" || !s.grpc_service) {
      console.error(`validate-runtime-config: grpc service needs grpc_port (number) and grpc_service: ${JSON.stringify(s)}`);
      process.exit(1);
    }
  } else if (ht === "auto") {
    if (typeof s.port !== "number" || !s.health_path || typeof s.grpc_port !== "number" || !s.grpc_service) {
      console.error(
        `validate-runtime-config: auto health needs port, health_path, grpc_port, grpc_service: ${JSON.stringify(s)}`,
      );
      process.exit(1);
    }
  } else if (ht === "http") {
    if (typeof s.port !== "number" || !s.health_path) {
      console.error(`validate-runtime-config: http service needs port and health_path: ${JSON.stringify(s)}`);
      process.exit(1);
    }
  } else {
    console.error(`validate-runtime-config: invalid health_type (http|grpc|auto): ${JSON.stringify(s)}`);
    process.exit(1);
  }
}
if (!topoValid(cfg.services)) {
  console.error("validate-runtime-config: depends_on cycle or unsatisfiable graph");
  process.exit(1);
}
console.log(`runtime config valid (${cfg.services.length} services: ${cfg.services.map((x) => x.name).join(", ")})`);
process.exit(0);
