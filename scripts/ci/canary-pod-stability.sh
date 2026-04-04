#!/usr/bin/env bash
# Post-deploy stability: no Failed pods; optional restart budget (last observed restartCount sum).
# Usage: HOUSING_NS=off-campus-housing-tracker CANARY_MAX_TOTAL_RESTARTS=50 ./scripts/ci/canary-pod-stability.sh
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
MAX_RESTARTS="${CANARY_MAX_TOTAL_RESTARTS:-80}"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

if ! kubectl get ns "$NS" --request-timeout=15s >/dev/null 2>&1; then
  echo "⚠️  Namespace $NS missing — skipping canary check"
  exit 0
fi

pod_count="$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${pod_count:-0}" -eq 0 ]]; then
  echo "⚠️  No pods in $NS — skipping canary check"
  exit 0
fi

echo "▶ Canary pod check (ns=$NS)"
kubectl get pods -n "$NS" -o wide --request-timeout=30s || true

if command -v jq >/dev/null 2>&1; then
  bad="$(
    kubectl get pods -n "$NS" -o json --request-timeout=30s \
      | jq '[.items[] | select(.status.phase != "Running" and .status.phase != "Succeeded")] | length'
  )"
  if [[ "${bad:-0}" -gt 0 ]]; then
    echo "❌ $bad pod(s) not Running/Succeeded" >&2
    kubectl get pods -n "$NS" --field-selector=status.phase!=Running,status.phase!=Succeeded -o wide >&2 || true
    exit 1
  fi
  restarts="$(
    kubectl get pods -n "$NS" -o json --request-timeout=30s \
      | jq '[.items[].status.containerStatuses[]? | .restartCount // 0] | add'
  )"
  echo "  total container restarts observed: ${restarts:-0} (budget ${MAX_RESTARTS})"
  if [[ "${restarts:-0}" -gt "$MAX_RESTARTS" ]]; then
    echo "❌ Restart budget exceeded" >&2
    exit 1
  fi
else
  echo "⚠️  jq not installed — skipping strict phase/restart checks (install jq for full canary gate)"
fi

echo "✅ Canary check passed"
exit 0
