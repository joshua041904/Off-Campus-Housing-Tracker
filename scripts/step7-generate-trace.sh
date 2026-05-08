#!/usr/bin/env bash
# Emit one W3C trace id (32 hex) to stdout after hitting the golden-path HTTP route with that trace.
# Used by Step7 Jaeger gates so validation targets a known trace instead of fishing in list results.
#
# Env:
#   E2E_API_BASE — default https://off-campus-housing.test
#   STEP7_SEED_PATH — default /api/debug/full-trace (multi-service Step7 / contract golden path)
#
# Jaeger UI (Step 7 validation): this script does not call Jaeger. For local UI use the all-in-one Service name
# `jaeger` (not `jaeger-query`): kubectl port-forward -n observability svc/jaeger 16686:16686 → http://127.0.0.1:16686
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Optional deterministic 32-hex trace id for Jaeger search (preflight / CI).
if [[ -n "${STEP7_TRACE_SEED_ID:-}" ]]; then
  if command -v shasum >/dev/null 2>&1; then
    TRACE_ID="$(printf '%s' "$STEP7_TRACE_SEED_ID" | shasum -a 256 | awk '{print $1}' | cut -c1-32)"
  elif command -v sha256sum >/dev/null 2>&1; then
    TRACE_ID="$(printf '%s' "$STEP7_TRACE_SEED_ID" | sha256sum | awk '{print $1}' | cut -c1-32)"
  else
    TRACE_ID="$(openssl rand -hex 16)"
  fi
else
  TRACE_ID="$(openssl rand -hex 16)"
fi
BASE="${E2E_API_BASE:-https://off-campus-housing.test}"
PATH_SEED="${STEP7_SEED_PATH:-/api/debug/full-trace}"
URL="${BASE%/}${PATH_SEED}"

CA_ARGS=()
if [[ -f "$ROOT/certs/dev-root.pem" ]]; then
  CA_ARGS=(--cacert "$ROOT/certs/dev-root.pem")
else
  CA_ARGS=(-k)
fi

curl -sS "${CA_ARGS[@]}" "$URL" \
  -H "traceparent: 00-${TRACE_ID}-0000000000000001-01" \
  -H "x-debug-replay: step7" \
  -H "x-och-edge-proto: h3" \
  -H "x-suite: ${OCH_X_SUITE:-bash}" \
  -o /dev/null

printf '%s\n' "$TRACE_ID"
