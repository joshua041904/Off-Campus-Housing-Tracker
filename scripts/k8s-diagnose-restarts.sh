#!/usr/bin/env bash
# High-signal dump for pods with container restarts (OOMKilled, probes, crash loops).
# Usage:
#   ./scripts/k8s-diagnose-restarts.sh [namespace]
# Env:
#   HOUSING_NS — used when namespace arg omitted (default: off-campus-housing-tracker)
#   K8S_DIAG_MIN_RESTARTS — pod included if sum(container restartCount) >= N (default: 1)
set -euo pipefail

NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
MIN_R="${K8S_DIAG_MIN_RESTARTS:-1}"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq required (brew install jq)" >&2; exit 1; }

echo "=== Namespace: $NS (pods with total container restarts >= $MIN_R) ==="
kubectl get pods -n "$NS" -o wide 2>/dev/null || true

echo ""
echo "=== Recent events (last 50, newest last) ==="
kubectl get events -n "$NS" --sort-by='.lastTimestamp' 2>/dev/null | tail -50 || true

while IFS=$'\t' read -r name sum || [[ -n "$name" ]]; do
  [[ -z "${name:-}" ]] && continue

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "=== Pod: $name (sum of container restarts: $sum) ==="
  kubectl get pod -n "$NS" "$name" -o json | jq '.status.containerStatuses[]? | {name, restartCount, state, lastState}'

  echo "--- describe (container status / last termination) ---"
  kubectl describe pod -n "$NS" "$name" 2>/dev/null | sed -n '/^Containers:/,$p' | head -120 || true

  while read -r cname; do
    [[ -z "$cname" ]] && continue
    echo "--- logs -c $cname (tail 35) ---"
    kubectl logs -n "$NS" "$name" -c "$cname" --tail=35 2>&1 | tail -35 || true
    echo "--- logs -c $cname --previous (tail 50) ---"
    kubectl logs -n "$NS" "$name" -c "$cname" --previous --tail=50 2>&1 | tail -50 || echo "(no previous or not restarted)"
  done < <(kubectl get pod -n "$NS" "$name" -o json | jq -r '.spec.containers[].name')
done < <(kubectl get pods -n "$NS" -o json | jq -r --argjson min "$MIN_R" '
  .items[]
  | .metadata.name as $n
  | ([.status.containerStatuses[]? | .restartCount] | add // 0) as $sum
  | select($sum >= $min)
  | "\($n)\t\($sum)"
')

echo ""
echo "=== Done ==="
