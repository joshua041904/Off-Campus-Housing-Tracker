#!/usr/bin/env bash
# Roll out housing workloads in dependency order (reduces gateway→auth and Kafka-consumer races).
# Usage: ./scripts/k8s-rollout-och-ordered.sh
#   HOUSING_NS=off-campus-housing-tracker  (default)
#   KUBECTL=kubectl  or use Colima via PATH shims

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
KUBECTL=(kubectl --request-timeout=30s)
STATUS_TIMEOUT="${ROLLOUT_STATUS_TIMEOUT:-600s}"

say() { printf "\n\033[1m%s\033[0m\n" "${*:-}"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }

roll_restart() {
  local d="$1"
  say "rollout restart $d"
  "${KUBECTL[@]}" rollout restart "deploy/$d" -n "$NS"
}

roll_wait() {
  local d="$1"
  say "rollout status $d (timeout $STATUS_TIMEOUT)"
  if ! "${KUBECTL[@]}" rollout status "deploy/$d" -n "$NS" --timeout="$STATUS_TIMEOUT"; then
    warn "rollout status failed for $d — check: kubectl get pods -n $NS -l app=$d"
    return 1
  fi
  ok "$d ready"
}

say "=== Ordered rollout (namespace=$NS) ==="

roll_restart auth-service
roll_wait auth-service

DEPS=(
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  notification-service
  media-service
)

for d in "${DEPS[@]}"; do
  roll_restart "$d" || true
done
for d in "${DEPS[@]}"; do
  roll_wait "$d" || true
done

roll_restart api-gateway
roll_wait api-gateway

ok "Ordered rollout finished (auth → app services → api-gateway)."
