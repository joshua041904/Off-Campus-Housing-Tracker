#!/usr/bin/env bash
# Ensure key deployments are fully ready before running functional tests.
# Eliminates intermittent 504 (gateway→listings timeout), 404 (shopping H3), curl 28 (auth), analytics DB timeout
# during rotation/restart windows. Call before any suite that hits api-gateway, listings, shopping, analytics, auth.
# Usage: SKIP_READINESS_GATE=1 to skip; READINESS_GRACE_SECONDS=8 (default).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS_ING="${NS_ING:-ingress-nginx}"
NS_APP="${NS_APP:-record-platform}"
READINESS_GRACE_SECONDS="${READINESS_GRACE_SECONDS:-8}"
READINESS_TIMEOUT="${READINESS_TIMEOUT:-120}"

[[ "${SKIP_READINESS_GATE:-0}" == "1" ]] && exit 0

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || true)
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

say "Ensuring deployments ready before functional tests (rollout status + grace)…"

# Caddy (ingress)
if _kb get deploy "caddy-h3" -n "$NS_ING" >/dev/null 2>&1; then
  _kb -n "$NS_ING" rollout status deploy/caddy-h3 --timeout="${READINESS_TIMEOUT}s" 2>/dev/null && ok "caddy-h3 ready" || warn "caddy-h3 rollout status timed out"
fi
# Core app deployments
for d in api-gateway auth-service listings-service records-service shopping-service analytics-service; do
  if _kb get deploy "$d" -n "$NS_APP" >/dev/null 2>&1; then
    _kb -n "$NS_APP" rollout status "deploy/$d" --timeout="${READINESS_TIMEOUT}s" 2>/dev/null && ok "$d ready" || warn "$d rollout status timed out"
  fi
done
# Optional: wait for pod condition so kube-proxy has updated endpoints
_kb -n "$NS_ING" wait --for=condition=ready pod -l app=caddy-h3 --timeout=60s 2>/dev/null || true
_kb -n "$NS_APP" wait --for=condition=ready pod -l app=api-gateway --timeout=60s 2>/dev/null || true

info "Grace ${READINESS_GRACE_SECONDS}s (DB pool warmup, caches)"
sleep "$READINESS_GRACE_SECONDS"
ok "Readiness gate complete; safe to run functional tests"
