#!/usr/bin/env bash
# Rollout + in-pod GET /metrics (Prometheus text) for ollama-gateway.
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/verify-ollama-gateway.sh
# Skip: BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 (same gate as apply-ollama-gateway-stack.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" == "1" ]]; then
  echo "verify-ollama-gateway: skipped (BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || {
  echo "::error::verify-ollama-gateway: kubectl required" >&2
  exit 1
}

if ! kubectl get deploy/ollama-gateway -n "$NS" --request-timeout=15s &>/dev/null; then
  echo "::error::verify-ollama-gateway: deployment/ollama-gateway missing (run apply-ollama-gateway-stack.sh / cold-bootstrap)" >&2
  exit 1
fi

_to="${VERIFY_OLLAMA_GATEWAY_ROLLOUT_TIMEOUT:-600}"
echo "▶ verify-ollama-gateway: rollout status (${_to}s)"
kubectl rollout status "deployment/ollama-gateway" -n "$NS" --timeout="${_to}s"

echo "▶ verify-ollama-gateway: GET /metrics via node fetch (in-pod)"
_out="$(kubectl exec -n "$NS" "deploy/ollama-gateway" -c gateway --request-timeout=60s -- \
  node -e "fetch('http://127.0.0.1:8081/metrics').then(async r=>{const t=await r.text();if(!r.ok||!t.includes('ollama_requests_total'))process.exit(1);process.exit(0)}).catch(()=>process.exit(1))" 2>&1)" || {
  echo "::error::verify-ollama-gateway: /metrics check failed" >&2
  echo "$_out" >&2
  exit 1
}

echo "✅ verify-ollama-gateway: OK"
