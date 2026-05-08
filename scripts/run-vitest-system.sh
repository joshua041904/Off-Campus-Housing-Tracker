#!/usr/bin/env bash
# System contract tests (vitest.system.config.mts).
#
# Root package.json overrides Rollup to @rollup/wasm-node — Vitest needs WebAssembly. Do not pass
# NODE_OPTIONS=--jitless (jitless V8 disables WASM and fails with "WebAssembly is not defined").
# If the parent shell exported --jitless, we strip it here before exec.
#
# Env:
#   OCH_INTEGRATION_KAFKA_FROM_K8S_LB — default 1 (same as prior package.json inline)
#   ROLLUP_DISABLE_NATIVE — forced true for Vitest stability
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export OCH_INTEGRATION_KAFKA_FROM_K8S_LB="${OCH_INTEGRATION_KAFKA_FROM_K8S_LB:-1}"
export ROLLUP_DISABLE_NATIVE=true

if [[ -n "${NODE_OPTIONS:-}" ]] && echo " ${NODE_OPTIONS} " | grep -qE '[[:space:]]--jitless[[:space:]]'; then
  echo "ℹ️  Removing --jitless from NODE_OPTIONS (incompatible with @rollup/wasm-node; WASM required)." >&2
  _out=()
  # shellcheck disable=SC2206
  _toks=(${NODE_OPTIONS})
  for _t in "${_toks[@]}"; do
    [[ "$_t" == "--jitless" ]] && continue
    _out+=("$_t")
  done
  if [[ ${#_out[@]} -gt 0 ]]; then
    export NODE_OPTIONS="${_out[*]}"
  else
    unset NODE_OPTIONS
  fi
fi

exec pnpm exec vitest run --config vitest.system.config.mts "$@"
