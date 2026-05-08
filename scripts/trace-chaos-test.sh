#!/usr/bin/env bash
# Scale down a housing deployment, expect trace-contract to FAIL, restore replicas.
# Usage: bash scripts/trace-chaos-test.sh [auth-service]
# Requires: kubectl, cluster, TRACE_CONTRACT prerequisites. Skip: TRACE_CHAOS_SKIP=1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-auth-service}"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

if [[ "${TRACE_CHAOS_SKIP:-0}" == "1" ]]; then
  echo "trace-chaos-test: TRACE_CHAOS_SKIP=1 — skipping"
  exit 0
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "trace-chaos-test: kubectl not found — skipping"
  exit 0
fi
if ! kubectl get deploy "$TARGET" -n "$NS" &>/dev/null; then
  echo "trace-chaos-test: no deploy/$TARGET in $NS — skipping"
  exit 0
fi

echo "🔥 chaos: scaling $TARGET to 0 in $NS"
kubectl scale "deploy/$TARGET" -n "$NS" --replicas=0
sleep "${TRACE_CHAOS_DOWN_WAIT_SEC:-8}"

set +e
JAEGER_QUERY_BASE="${JAEGER_QUERY_BASE:-}" E2E_API_BASE="${E2E_API_BASE:-https://off-campus-housing.test}" \
  bash "$ROOT/scripts/trace-contract-test.sh"
RC=$?
set -e

echo "🔁 chaos: restoring $TARGET"
kubectl scale "deploy/$TARGET" -n "$NS" --replicas=1
kubectl rollout status "deploy/$TARGET" -n "$NS" --timeout=240s

if [[ "$RC" -eq 0 ]]; then
  echo "::error::CHAOS TEST FAILED: trace contract still passed with $TARGET scaled to 0 (expected failure)"
  exit 1
fi

echo "✅ CHAOS TEST PASSED: trace contract failed as expected (rc=$RC) while $TARGET was down"
