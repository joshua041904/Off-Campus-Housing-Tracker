#!/usr/bin/env bash
# Wait until core housing Services have Endpoint addresses (not just Deployment Available).
# Colima/k3s: kube-dns + EndpointSlice propagation can lag pod Ready — gate smoke / edge curls on this.
# Missing Deployment for a listed Service is a hard error (no skip): Service without Pods → empty Endpoints → 502.
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/wait-for-housing-service-endpoints.sh
# Env:
#   WAIT_HOUSING_ENDPOINTS_TIMEOUT — per-service deadline seconds (default 240)
#   WAIT_HOUSING_OLLAMA_TIMEOUT   — Ollama-specific deadline seconds (default 600)
#   WAIT_HOUSING_ENDPOINTS_SLEEP  — poll interval (default 2)
#   WAIT_HOUSING_OLLAMA_API_PROBE — default 1: after rollout+Ready, probe /api/version from api-gateway pod
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
TIMEOUT="${WAIT_HOUSING_ENDPOINTS_TIMEOUT:-240}"
OLLAMA_TIMEOUT="${WAIT_HOUSING_OLLAMA_TIMEOUT:-600}"
SLEEP_SEC="${WAIT_HOUSING_ENDPOINTS_SLEEP:-2}"

SERVICES=(
  ollama
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

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
bad() { echo "❌ $*" >&2; }

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

if [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=10s &>/dev/null; then
    och_export_colima_kubeconfig_prefer_reachable || true
  fi
fi

_endpoints_have_addrs() {
  local svc="$1"
  local out
  out="$(kubectl get "endpoints/$svc" -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' --request-timeout=15s 2>/dev/null || true)"
  [[ -n "${out// /}" ]]
}

_probe_ollama_api_from_gateway() {
  local gwpod=""
  gwpod="$(kubectl get pods -n "$NS" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' --request-timeout=15s 2>/dev/null || true)"
  [[ -z "${gwpod:-}" ]] && return 1
  kubectl exec -n "$NS" "$gwpod" -- sh -lc 'wget -qO- --timeout=8 http://ollama:11434/api/version >/dev/null' >/dev/null 2>&1
}

wait_ollama() {
  local start=$SECONDS
  if ! kubectl get deployment ollama -n "$NS" --request-timeout=15s &>/dev/null; then
    bad "Deployment/ollama missing in $NS — cannot gate Ollama readiness."
    return 1
  fi

  echo "  ▶ Ollama ML gate: rollout status (timeout ${OLLAMA_TIMEOUT}s)…"
  if ! kubectl rollout status deployment/ollama -n "$NS" --timeout="${OLLAMA_TIMEOUT}s" >/dev/null 2>&1; then
    bad "Deployment/ollama rollout did not complete within ${OLLAMA_TIMEOUT}s"
    return 1
  fi

  local remaining=$(( OLLAMA_TIMEOUT - (SECONDS - start) ))
  (( remaining < 30 )) && remaining=30
  echo "  ▶ Ollama ML gate: pod condition Ready (timeout ${remaining}s)…"
  if ! kubectl wait --for=condition=Ready pod -l app=ollama -n "$NS" --timeout="${remaining}s" >/dev/null 2>&1; then
    bad "Ollama pods not Ready within ${OLLAMA_TIMEOUT}s"
    return 1
  fi

  remaining=$(( OLLAMA_TIMEOUT - (SECONDS - start) ))
  (( remaining < 10 )) && remaining=10
  echo "  ▶ Waiting for Endpoints/ollama addresses (timeout ${remaining}s)…"
  while (( SECONDS - start < OLLAMA_TIMEOUT )); do
    if _endpoints_have_addrs "ollama"; then
      break
    fi
    sleep "$SLEEP_SEC"
  done
  if ! _endpoints_have_addrs "ollama"; then
    bad "Endpoints/ollama: no addresses within ${OLLAMA_TIMEOUT}s (cold start / readiness still converging)"
    return 1
  fi

  if [[ "${WAIT_HOUSING_OLLAMA_API_PROBE:-1}" == "1" ]]; then
    echo "  ▶ Ollama ML gate: in-cluster API probe (/api/version via api-gateway pod)…"
    local api_deadline=$((SECONDS + remaining))
    while (( SECONDS < api_deadline )); do
      if _probe_ollama_api_from_gateway; then
        ok "Ollama API probe OK (/api/version)"
        ok "Endpoints/ollama has addresses"
        return 0
      fi
      sleep "$SLEEP_SEC"
    done
    bad "Ollama API probe did not succeed within ${OLLAMA_TIMEOUT}s"
    return 1
  fi

  ok "Endpoints/ollama has addresses"
  return 0
}

wait_one() {
  local svc="$1"
  local start=$SECONDS
  local timeout="$TIMEOUT"
  if [[ "$svc" == "ollama" ]]; then
    wait_ollama
    return $?
  fi
  if ! kubectl get deployment "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    bad "Deployment/$svc missing in $NS — Service may exist but no Pods/Endpoints → upstream 502. Apply kustomize (infra/k8s/overlays/dev) or fix manifests."
    return 1
  fi
  echo "  ▶ Waiting for Endpoints/$svc ($NS) …"
  kubectl wait --for=condition=available "deployment/$svc" -n "$NS" --timeout=120s >/dev/null 2>&1 || true
  while (( SECONDS - start < timeout )); do
    if _endpoints_have_addrs "$svc"; then
      ok "Endpoints/$svc has addresses"
      return 0
    fi
    sleep "$SLEEP_SEC"
  done
  bad "Endpoints/$svc: no addresses within ${timeout}s (kube-proxy / DNS not ready?)"
  return 1
}

say "wait-for-housing-service-endpoints (ns=$NS timeout_per_svc=${TIMEOUT}s ollama_timeout=${OLLAMA_TIMEOUT}s)"
for s in "${SERVICES[@]}"; do
  wait_one "$s"
done
ok "All present housing Services have Endpoint addresses"
