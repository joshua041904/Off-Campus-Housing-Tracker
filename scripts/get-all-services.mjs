#!/usr/bin/env node
/**
 * Print JSON array of housing *-service directory names (auth-service, …).
 * Usage: node scripts/get-all-services.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverHousingServiceDirs } from "./trace-validators/lib/housing-services.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const services = discoverHousingServiceDirs(root);
process.stdout.write(`${JSON.stringify(services)}\n`);
