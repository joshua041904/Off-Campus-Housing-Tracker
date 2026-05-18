#!/usr/bin/env node
/**
 * CI guard: fail if native @rollup/rollup-* packages appear in the pnpm dependency tree.
 * Root package.json must override `rollup` to `npm:@rollup/wasm-node@...`.
 */
import { execSync } from "node:child_process";

let output;
try {
  output = execSync("pnpm ls --depth 99 --json", {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
} catch (e) {
  const err = e;
  if (err && typeof err === "object" && "stdout" in err && typeof err.stdout === "string") {
    output = err.stdout;
  } else {
    console.error("rollup-wasm-guard: pnpm ls failed", err);
    process.exit(1);
  }
}

const text = output.toLowerCase();
if (text.includes("@rollup/rollup-")) {
  console.error(
    "rollup-wasm-guard: failure (native @rollup/rollup-* leaked — use @rollup/wasm-node override at workspace root)",
  );
  process.exit(1);
}

console.log("rollup-wasm-guard: ok");
