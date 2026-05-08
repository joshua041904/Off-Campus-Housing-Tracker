#!/usr/bin/env node
/**
 * TTL-prune bench_logs/nodeport_registry.json (default 24h). Safe to run anytime.
 */
import { cleanupNodeportRegistryFile } from "./lib/nodeport-registry.mjs";

const r = cleanupNodeportRegistryFile();
console.log(JSON.stringify({ ok: true, ...r }, null, 2));
