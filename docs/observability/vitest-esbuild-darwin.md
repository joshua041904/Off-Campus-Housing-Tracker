# Vitest / esbuild on macOS (darwin-arm64)

## Symptom

Vitest fails to start with a missing **esbuild** native binary (`@esbuild/darwin-arm64`).

## Cause

Install ran with **optional dependencies disabled**, so the platform-specific esbuild package was skipped.

In this repo, root **`.npmrc` must not set `optional=false`**: that skips esbuild’s `@esbuild/darwin-arm64` (and other platform packages). Rollup remains wasm-only via `package.json` `pnpm.overrides`; **CI** still fails if native `@rollup/rollup-*` appears (`scripts/ci/verify-no-rollup-native-packages.sh`).

## Fix (in order)

1. Ensure optionals install:

   ```bash
   cd /path/to/Off-Campus-Housing-Tracker
   pnpm install --no-optional=false
   ```

2. Rebuild native helper:

   ```bash
   pnpm rebuild esbuild
   ```

3. If still broken, add the platform package explicitly (match esbuild version used by Vitest in your lockfile):

   ```bash
   pnpm add -D @esbuild/darwin-arm64
   ```

4. Last resort: clean install:

   ```bash
   rm -rf node_modules
   rm pnpm-lock.yaml   # only if team agrees to regenerate lockfile
   pnpm install --no-optional=false
   ```

This is **local tooling only**; not related to Kubernetes or Kafka.
