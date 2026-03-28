#!/usr/bin/env bash
# Roll out Envoy (envoy-test gRPC edge + optional ingress-nginx envoy) and OCH app workloads
# after Postgres recycle / pool tuning so pods pick up new Prisma pool sizes and refreshed config.
#
# Usage (repo root):
#   ./scripts/rollout-restart-och-after-pool-tuning.sh
#
# Env:
#   KUBECTL  — default kubectl
#   OCH_NS   — default off-campus-housing-tracker
#   INGRESS_NS — default ingress-nginx
#   SKIP_ENVOY — 1: skip all Envoy deployment restarts
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
OCH_NS="${OCH_NS:-off-campus-housing-tracker}"
INGRESS_NS="${INGRESS_NS:-ingress-nginx}"
SKIP_ENVOY="${SKIP_ENVOY:-0}"

OCH_DEPLOYMENTS=(
  api-gateway
  auth-service
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
  webapp
)

if [[ "$SKIP_ENVOY" != "1" ]]; then
  if "$KUBECTL" get deploy envoy-test -n envoy-test &>/dev/null; then
    echo "Rollout restart: deployment/envoy-test -n envoy-test"
    "$KUBECTL" rollout restart deployment/envoy-test -n envoy-test
    "$KUBECTL" rollout status deployment/envoy-test -n envoy-test --timeout=300s
  fi
  if "$KUBECTL" get deploy envoy -n "$INGRESS_NS" &>/dev/null; then
    echo "Rollout restart: deployment/envoy -n $INGRESS_NS"
    "$KUBECTL" rollout restart deployment/envoy -n "$INGRESS_NS"
    "$KUBECTL" rollout status deployment/envoy -n "$INGRESS_NS" --timeout=300s
  fi
fi

echo "Rollout restart: ${OCH_DEPLOYMENTS[*]} -n $OCH_NS"
"$KUBECTL" rollout restart deployment "${OCH_DEPLOYMENTS[@]}" -n "$OCH_NS"
for d in "${OCH_DEPLOYMENTS[@]}"; do
  "$KUBECTL" rollout status "deployment/$d" -n "$OCH_NS" --timeout=300s
done

echo "Done."
