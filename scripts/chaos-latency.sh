#!/usr/bin/env bash
# Inject netem delay on a pod (requires tc + privileged — often fails on hardened images).
#
#   CHAOS_LATENCY_CONFIRM=1 CHAOS_LATENCY_MS=300 CHAOS_LATENCY_DEPLOY=api-gateway ./scripts/chaos-latency.sh
# Remove: CHAOS_LATENCY_REMOVE=1 (same CHAOS_LATENCY_DEPLOY)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CHAOS_LATENCY_NS:-off-campus-housing-tracker}"
DEP="${CHAOS_LATENCY_DEPLOY:-api-gateway}"
MS="${CHAOS_LATENCY_MS:-300}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${CHAOS_ARTIFACT_DIR:-$REPO_ROOT/bench_logs/chaos-latency-$STAMP}"
mkdir -p "$ART"

POD=$(kubectl get pods -n "$NS" -l "app=$DEP" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[[ -n "$POD" ]] || { echo "No pod for app=$DEP in $NS"; exit 1; }
CTR="${CHAOS_LATENCY_CONTAINER:-$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.spec.containers[0].name}' 2>/dev/null || echo app)}"

if [[ "${CHAOS_LATENCY_REMOVE:-0}" == "1" ]]; then
  kubectl exec -n "$NS" "$POD" -c "$CTR" -- sh -c "tc qdisc del dev eth0 root 2>/dev/null; true" | tee "$ART/remove.log" || true
  exit 0
fi

if [[ "${CHAOS_LATENCY_CONFIRM:-0}" != "1" ]]; then
  echo "Set CHAOS_LATENCY_CONFIRM=1 to inject ${MS}ms delay on $NS/$POD ($CTR)."
  echo "Remove: CHAOS_LATENCY_REMOVE=1 CHAOS_LATENCY_DEPLOY=$DEP ./scripts/chaos-latency.sh"
  exit 0
fi

kubectl exec -n "$NS" "$POD" -c "$CTR" -- sh -c "
  command -v tc >/dev/null 2>&1 || { echo no tc; exit 1; }
  tc qdisc del dev eth0 root 2>/dev/null || true
  tc qdisc add dev eth0 root netem delay ${MS}ms
  echo ok
" 2>&1 | tee "$ART/inject.log" || true

python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "latency ${MS}ms on $DEP" || true
