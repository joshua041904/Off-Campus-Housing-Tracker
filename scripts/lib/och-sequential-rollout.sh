#!/usr/bin/env bash
# Ordered rollout restart for OCH app Deployments (reduces readiness flapping after TLS / Kafka churn).
# Dependency-ish order: core data services → Kafka consumers → edge gateway. Caddy last (ingress).
#
# Usage:
#   Default: uses kubectl --request-timeout=25s
#   Before sourcing from reissue-ca-and-leaf-load-all-services.sh, define:
#     och_kubectl() { kctl "$@"; }
#
# Env:
#   OCH_ROLLOUT_NS — app namespace (default off-campus-housing-tracker)
#   NS_ING — ingress namespace for Caddy (default ingress-nginx)
#   OCH_ROLLOUT_STATUS_TIMEOUT — seconds for each kubectl rollout status (default 180)

if ! declare -F och_kubectl >/dev/null 2>&1; then
  och_kubectl() {
    kubectl --request-timeout=25s "$@"
  }
fi

och_rollout_ordered_housing_apps() {
  local ns="${OCH_ROLLOUT_NS:-off-campus-housing-tracker}"
  local timeout="${OCH_ROLLOUT_STATUS_TIMEOUT:-180}"
  local -a deps=(
    auth-service
    listings-service
    booking-service
    messaging-service
    trust-service
    analytics-service
    media-service
    notification-service
    api-gateway
  )
  local d
  for d in "${deps[@]}"; do
    if och_kubectl -n "$ns" get deploy "$d" >/dev/null 2>&1; then
      och_kubectl -n "$ns" rollout restart "deploy/$d" >/dev/null 2>&1 \
        && echo "  ✅ rollout restart $d (sequential)" \
        || echo "  ⚠️  rollout restart $d failed"
      och_kubectl -n "$ns" rollout status "deploy/$d" --timeout="${timeout}s" >/dev/null 2>&1 \
        && echo "  ✅ rollout status $d (≤${timeout}s)" \
        || echo "  ⚠️  rollout status $d not ready within ${timeout}s (continuing)"
    fi
  done
}

och_rollout_caddy_last() {
  local ns_ing="${NS_ING:-ingress-nginx}"
  local timeout="${OCH_ROLLOUT_STATUS_TIMEOUT:-180}"
  if och_kubectl -n "$ns_ing" get deploy caddy-h3 >/dev/null 2>&1; then
    och_kubectl -n "$ns_ing" rollout restart deploy/caddy-h3 >/dev/null 2>&1 \
      && echo "  ✅ rollout restart caddy-h3 (last)" \
      || echo "  ⚠️  rollout restart caddy-h3 failed"
    och_kubectl -n "$ns_ing" rollout status deploy/caddy-h3 --timeout="${timeout}s" >/dev/null 2>&1 \
      && echo "  ✅ rollout status caddy-h3" \
      || echo "  ⚠️  rollout status caddy-h3 not ready within ${timeout}s"
  fi
}
