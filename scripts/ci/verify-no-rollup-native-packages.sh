#!/usr/bin/env bash
# CI guard: after pnpm install, fail if native @rollup/rollup-* optional packages appear.
# Root package.json should override rollup to npm:@rollup/wasm-node@<version>.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules/.pnpm ]]; then
  echo "verify-no-rollup-native: node_modules/.pnpm missing — run pnpm install first"
  exit 1
fi

matches="$(find node_modules/.pnpm -maxdepth 1 -name '@rollup+rollup-*' -print 2>/dev/null || true)"
if [[ -n "$matches" ]]; then
  echo "::error::Native @rollup/rollup-* packages found under node_modules/.pnpm — wasm override broken or optional=false disabled incorrectly."
  echo "$matches"
  exit 1
fi

echo "verify-no-rollup-native: OK (no @rollup+rollup-* under node_modules/.pnpm)"
