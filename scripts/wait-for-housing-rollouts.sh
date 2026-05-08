#!/usr/bin/env bash
# Block until each housing Deployment rollout completes and readyReplicas == spec.replicas.
# Fails if a Deployment is missing (no silent skip).
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/wait-for-housing-rollouts.sh
# Env:
#   ROLLOUT_TIMEOUT — kubectl rollout status timeout seconds (default 180)
#   ROLLOUT_TIMEOUT_OLLAMA — timeout for deployment/ollama only (default 1200; first model pull is slow)
#   ROLLOUT_TIMEOUT_OLLAMA_REDIS / ROLLOUT_TIMEOUT_OLLAMA_GATEWAY / ROLLOUT_TIMEOUT_OLLAMA_WORKER — gateway stack (defaults 300/900/600)
#   BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 — skip ollama-gateway-redis / ollama-gateway / ollama-worker (not deployed)
#   OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1 (default) — skip rollout wait for ollama-gateway-redis if Deployment is absent (external Redis).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
TIMEOUT="${ROLLOUT_TIMEOUT:-180}"

SERVICES=(
  ollama
  ollama-gateway-redis
  ollama-gateway
  ollama-worker
  api-gateway
  auth-service
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
)

command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required" >&2; exit 1; }

if [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=10s &>/dev/null; then
    och_export_colima_kubeconfig_prefer_reachable || true
  fi
fi

printf '\n\033[1m%s\033[0m\n' "wait-for-housing-rollouts (ns=$NS timeout=${TIMEOUT}s)"

for svc in "${SERVICES[@]}"; do
  if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" == "1" ]] && { [[ "$svc" == "ollama-gateway-redis" ]] || [[ "$svc" == "ollama-gateway" ]] || [[ "$svc" == "ollama-worker" ]]; }; then
    echo "  ⏭️  rollout skip: $svc (BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1)"
    continue
  fi
  if [[ "${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}" == "1" ]] && [[ "$svc" == "ollama-gateway-redis" ]]; then
    echo "  ⏭️  rollout skip: $svc (OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1)"
    continue
  fi
  echo "  ▶ rollout wait: $svc"
  if ! kubectl get deploy "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    echo "::error::deployment/$svc missing in $NS" >&2
    exit 1
  fi
  _to="$TIMEOUT"
  case "$svc" in
    ollama) _to="${ROLLOUT_TIMEOUT_OLLAMA:-1200}" ;;
    ollama-gateway-redis) _to="${ROLLOUT_TIMEOUT_OLLAMA_REDIS:-300}" ;;
    ollama-gateway) _to="${ROLLOUT_TIMEOUT_OLLAMA_GATEWAY:-900}" ;;
    ollama-worker) _to="${ROLLOUT_TIMEOUT_OLLAMA_WORKER:-600}" ;;
  esac
  kubectl rollout status "deployment/$svc" -n "$NS" --timeout="${_to}s"
  desired="$(kubectl get deploy "$svc" -n "$NS" -o jsonpath='{.spec.replicas}' --request-timeout=15s)"
  ready="$(kubectl get deploy "$svc" -n "$NS" -o jsonpath='{.status.readyReplicas}' --request-timeout=15s)"
  desired="${desired:-1}"
  ready="${ready:-0}"
  if [[ "$ready" != "$desired" ]]; then
    echo "::error::$svc not fully ready ($ready/$desired desired)" >&2
    exit 1
  fi
  echo "  ✅ $svc rollout complete ($ready/$desired)"
done

echo "✅ all housing rollouts ready"
