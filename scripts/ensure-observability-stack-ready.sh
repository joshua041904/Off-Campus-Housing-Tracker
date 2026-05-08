#!/usr/bin/env bash
# After housing workloads apply, ensure observability namespace stack is present and Deployments are Available.
# Applies infra/k8s/base/observability (idempotent) then rollout status for Jaeger, OTel collector, Prometheus, Grafana.
#
# Env:
#   SKIP_OBSERVABILITY_WAIT=1 — no-op success
#   OBSERVABILITY_ROLLOUT_TIMEOUT — per-deployment kubectl rollout status timeout (default 300s)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${OBSERVABILITY_NS:-observability}"
ROLL_TIMEOUT="${OBSERVABILITY_ROLLOUT_TIMEOUT:-300s}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

if [[ "${SKIP_OBSERVABILITY_WAIT:-0}" == "1" ]]; then
  say "ensure-observability-stack-ready (skipped: SKIP_OBSERVABILITY_WAIT=1)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

say "=== Observability stack ($NS) ==="

KUST_OBS="$REPO_ROOT/infra/k8s/base/observability"
if [[ ! -f "$KUST_OBS/kustomization.yaml" ]]; then
  bad "Missing $KUST_OBS/kustomization.yaml"
  exit 1
fi

say "Apply kustomize observability (idempotent)"
if command -v kustomize &>/dev/null; then
  kustomize build "$KUST_OBS" | kubectl apply -f -
else
  kubectl kustomize "$KUST_OBS" | kubectl apply -f -
fi
ok "Observability manifests applied"

say "Wait for core deployments (Jaeger, OTel, Prometheus, Grafana)"
for dep in jaeger otel-collector prometheus grafana; do
  if ! kubectl get deployment "$dep" -n "$NS" --request-timeout=20s &>/dev/null; then
    bad "Deployment/$dep not found in namespace $NS (kustomize apply failed or resources pruned?)"
    exit 1
  fi
  echo "  ▶ rollout status deployment/$dep"
  if ! kubectl rollout status "deployment/$dep" -n "$NS" --timeout="$ROLL_TIMEOUT"; then
    bad "deployment/$dep did not become ready in $NS"
    kubectl get pods -n "$NS" -l "app=$dep" -o wide 2>/dev/null || kubectl get pods -n "$NS" -o wide || true
    exit 1
  fi
  ok "$dep ready"
done

if [[ -f "$SCRIPT_DIR/validate-jaeger-lb.sh" ]]; then
  say "Validate Jaeger Service ports (16686, 4318)"
  bash "$SCRIPT_DIR/validate-jaeger-lb.sh"
fi

ok "Observability stack ready (Jaeger + OTel collector + Prometheus + Grafana in $NS). UI: kubectl -n $NS port-forward svc/jaeger 16686:16686"
