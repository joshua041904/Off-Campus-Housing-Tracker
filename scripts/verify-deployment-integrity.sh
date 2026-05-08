#!/usr/bin/env bash
# Fail (or optionally re-apply kustomize) when housing Services lack matching Deployments,
# selector alignment, Pods, or Endpoint addresses — prevents silent 502s (Service with no backends).
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/verify-deployment-integrity.sh
# Env:
#   AUTO_HEAL_DEPLOYMENTS=1     — kubectl apply dev overlay once (or twice max) then re-check
#   HOUSING_KUSTOMIZE_OVERLAY   — dir under infra/k8s (default overlays/dev)
#   VERIFY_DEPLOY_INTEGRITY_MAX_HEAL — max auto-heal rounds (default 2)
#   VERIFY_DEPLOY_INTEGRITY_ENDPOINT_WAIT_SEC — retry window when Endpoints are empty (default 20)
#   VERIFY_DEPLOY_INTEGRITY_OLLAMA_ENDPOINT_WAIT_SEC — ollama-specific retry window (default 60)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
AUTO_HEAL="${AUTO_HEAL_DEPLOYMENTS:-0}"
KUST_ROOT="${REPO_ROOT}/infra/k8s"
OVERLAY_REL="${HOUSING_KUSTOMIZE_OVERLAY:-overlays/dev}"
MAX_HEAL="${VERIFY_DEPLOY_INTEGRITY_MAX_HEAL:-2}"
HEAL_ATTEMPT="${VERIFY_DEPLOY_INTEGRITY_HEAL_ATTEMPT:-0}"
ENDPOINT_WAIT_SEC="${VERIFY_DEPLOY_INTEGRITY_ENDPOINT_WAIT_SEC:-20}"
OLLAMA_ENDPOINT_WAIT_SEC="${VERIFY_DEPLOY_INTEGRITY_OLLAMA_ENDPOINT_WAIT_SEC:-60}"

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

failures=()

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

if [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=10s &>/dev/null; then
    och_export_colima_kubeconfig_prefer_reachable || true
  fi
fi

check_service() {
  local svc="$1"

  if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" == "1" ]] && { [[ "$svc" == "ollama-gateway-redis" ]] || [[ "$svc" == "ollama-gateway" ]] || [[ "$svc" == "ollama-worker" ]]; }; then
    echo "  ⏭️  skip $svc (BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1)"
    return
  fi
  if [[ "${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}" == "1" ]] && [[ "$svc" == "ollama-gateway-redis" ]]; then
    echo "  ⏭️  skip $svc (OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1)"
    return
  fi

  echo "  ▶ checking $svc"

  if ! kubectl get svc "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    echo "::error::$svc Service missing in $NS"
    failures+=("$svc:service")
    return
  fi

  if ! kubectl get deploy "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    echo "::error::$svc Deployment missing in $NS"
    failures+=("$svc:deployment")
    return
  fi

  local svc_app deploy_app
  svc_app="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
  deploy_app="$(kubectl get deploy "$svc" -n "$NS" -o jsonpath='{.spec.selector.matchLabels.app}' 2>/dev/null || true)"

  if [[ -n "$svc_app" || -n "$deploy_app" ]]; then
    if [[ "$svc_app" != "$deploy_app" ]]; then
      echo "::error::$svc selector mismatch: Service.spec.selector.app=${svc_app:-∅} Deployment.spec.selector.matchLabels.app=${deploy_app:-∅}"
      failures+=("$svc:selector")
    fi
  fi

  local app_label="${deploy_app:-$svc_app}"
  if [[ -z "$app_label" ]]; then
    echo "::error::$svc has no app label in Service selector or Deployment matchLabels (extend script for custom selectors)"
    failures+=("$svc:selector-unknown")
    return
  fi

  local pod_lines
  pod_lines="$(kubectl get pods -n "$NS" -l "app=$app_label" --request-timeout=20s --no-headers 2>/dev/null | awk 'NF>0 {c++} END {print c+0}')"
  if [[ "${pod_lines:-0}" == "0" ]]; then
    echo "::error::$svc has no Pods for app=$app_label"
    failures+=("$svc:pods")
  fi

  local eps
  eps="$(kubectl get endpoints "$svc" -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' --request-timeout=15s 2>/dev/null || true)"
  if [[ -z "${eps// /}" ]]; then
    local wait_sec="$ENDPOINT_WAIT_SEC"
    if [[ "$svc" == "ollama" ]]; then
      wait_sec="$OLLAMA_ENDPOINT_WAIT_SEC"
    fi

    # Auto-heal can trigger a rollout; endpoints may be empty briefly before controller repopulates subsets.
    # For Ollama this window is often longer due to model warm-up and probe stabilization.
    if kubectl wait -n "$NS" --for=jsonpath='{.subsets[*].addresses[*].ip}' "endpoints/$svc" --timeout="${wait_sec}s" >/dev/null 2>&1; then
      eps="$(kubectl get endpoints "$svc" -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' --request-timeout=15s 2>/dev/null || true)"
    fi

    if [[ -z "${eps// /}" ]]; then
      echo "::error::$svc Endpoints have no addresses (after ${wait_sec}s retry window)"
      failures+=("$svc:endpoints")
    fi
  fi

  ok "$svc OK"
}

_apply_overlay() {
  local od="$KUST_ROOT/$OVERLAY_REL"
  if [[ ! -d "$od" ]]; then
    bad "Kustomize overlay not found: $od"
    return 1
  fi
  say "AUTO_HEAL: kubectl apply kustomize $OVERLAY_REL → $NS"
  if command -v kustomize &>/dev/null 2>&1; then
    kustomize build "$od" | kubectl apply -f -
  else
    kubectl kustomize "$od" | kubectl apply -f -
  fi
}

say "verify-deployment-integrity (ns=$NS AUTO_HEAL=$AUTO_HEAL heal_attempt=$HEAL_ATTEMPT/$MAX_HEAL)"

for svc in "${SERVICES[@]}"; do
  check_service "$svc"
done

if [[ ${#failures[@]} -eq 0 ]]; then
  ok "all listed services have Deployments, Pods, and Endpoint addresses"
  exit 0
fi

bad "integrity failures:"
printf '  %s\n' "${failures[@]}" >&2

if [[ "$AUTO_HEAL" == "1" ]]; then
  if (( HEAL_ATTEMPT >= MAX_HEAL )); then
    bad "AUTO_HEAL exhausted ($MAX_HEAL rounds); fix manifests or cluster state."
    exit 1
  fi
  _apply_overlay || exit 1
  echo "  ⏳ post-apply settle…"
  sleep 5
  export VERIFY_DEPLOY_INTEGRITY_HEAL_ATTEMPT=$((HEAL_ATTEMPT + 1))
  exec bash "$0" "$@"
fi

exit 1
