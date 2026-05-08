#!/usr/bin/env bash
# Apply root k8s/ Ollama gateway stack (optional in-cluster Redis Stack + gateway + worker). Idempotent kubectl apply.
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/apply-ollama-gateway-stack.sh
# Skip: BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1
# OLLAMA_GATEWAY_USE_EXTERNAL_REDIS (default 1): skip k8s/redis.yaml + ollama-gateway-redis rollout; gateway/worker use
#   app-config REDIS_URL (e.g. redis://host.docker.internal:6380/0 for Docker Compose redis). Set to 0 to deploy Redis Stack in-cluster.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-${NAMESPACE:-off-campus-housing-tracker}}"

if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" == "1" ]]; then
  echo "apply-ollama-gateway-stack: skipped (BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || {
  echo "::error::apply-ollama-gateway-stack: kubectl required" >&2
  exit 1
}

if [[ ! -f "$ROOT/k8s/ollama-gateway.yaml" ]]; then
  echo "::error::apply-ollama-gateway-stack: missing $ROOT/k8s/ollama-gateway.yaml" >&2
  exit 1
fi

USE_EXT="${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}"
echo "▶ apply-ollama-gateway-stack: ns=$NS (OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=${USE_EXT})"

# Manifests pin metadata.namespace (housing); do not pass -n (avoids mismatch if HOUSING_NS differs).
if [[ "$USE_EXT" != "1" ]]; then
  kubectl apply -f "$ROOT/k8s/redis.yaml" --request-timeout=120s
else
  echo "▶ skip k8s/redis.yaml (OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1 — use app-config REDIS_URL, e.g. host :6380)"
fi
kubectl apply -f "$ROOT/k8s/ollama-gateway-configmap.yaml" --request-timeout=120s
kubectl apply -f "$ROOT/k8s/ollama-gateway.yaml" --request-timeout=120s
kubectl apply -f "$ROOT/k8s/ollama-worker-configmap.yaml" --request-timeout=120s
kubectl apply -f "$ROOT/k8s/ollama-worker.yaml" --request-timeout=120s

_redis_to="${ROLLOUT_TIMEOUT_OLLAMA_REDIS:-300}"
_gw_to="${ROLLOUT_TIMEOUT_OLLAMA_GATEWAY:-900}"
_wrk_to="${ROLLOUT_TIMEOUT_OLLAMA_WORKER:-600}"

if [[ "$USE_EXT" != "1" ]]; then
  echo "▶ rollout status ollama-gateway-redis (${_redis_to}s)"
  kubectl rollout status "deployment/ollama-gateway-redis" -n "$NS" --timeout="${_redis_to}s"
else
  echo "▶ skip rollout ollama-gateway-redis (external Redis)"
fi

echo "▶ rollout status ollama-gateway (${_gw_to}s)"
kubectl rollout status "deployment/ollama-gateway" -n "$NS" --timeout="${_gw_to}s"

echo "▶ rollout status ollama-worker (${_wrk_to}s)"
kubectl rollout status "deployment/ollama-worker" -n "$NS" --timeout="${_wrk_to}s"

echo "✅ apply-ollama-gateway-stack: apply + rollouts OK"
