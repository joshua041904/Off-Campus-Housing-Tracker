#!/usr/bin/env node
/**
 * Patch ingress-nginx/caddy-h3 https + https-udp nodePorts to reserved split (30443 TCP / 30444 UDP).
 * Usage: node scripts/apply-caddy-edge-nodeports.mjs
 */
import { remediateCaddyHttpsReservedPatch } from "./lib/nodeport-registry.mjs";

const out = remediateCaddyHttpsReservedPatch();
const ok = out.ok !== false;
console.log(JSON.stringify({ ok, ...out }, null, 2));
process.exit(ok ? 0 : 1);
