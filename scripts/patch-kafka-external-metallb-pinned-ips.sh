#!/usr/bin/env bash
# MetalLB kafka-*-external IP pinning is REMOVED: allocator assigns LoadBalancer IPs; TLS SANs follow live IPs
# (scripts/kafka-refresh-tls-from-lb.sh + scripts/wait-for-kafka-external-lb-ips.sh). Manual spec.loadBalancerIP /
# annotation pinning caused allocator conflicts ("sharing key" / "address also in use") on cold bootstrap.
#
# apply-kafka-kraft-staged.sh runs STRIP automatically after stage1 Services (so make cold-bootstrap / bootstrap
# need no manual step). Manual recovery:
#   STRIP_KAFKA_EXTERNAL_REQUESTED_LB_IP=1 HOUSING_NS=… — JSON-remove spec.loadBalancerIP from kafka-N-external
#   (clears stale "Desired LoadBalancer IP" after upgrading from pinned flows).
#
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS (for strip mode only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

# Strip runs first so cold-bootstrap / apply-kafka-kraft-staged can clear legacy pins even when
# KAFKA_SKIP_METALLB_EXTERNAL_PIN=1 (that env only skips the removed pin path, not recovery).
if [[ "${STRIP_KAFKA_EXTERNAL_REQUESTED_LB_IP:-0}" == "1" ]]; then
  echo "=== strip spec.loadBalancerIP from kafka-*-external (ns=$NS replicas=$REP) ==="
  for ((i = 0; i < REP; i++)); do
    svc="kafka-${i}-external"
    kubectl get svc "$svc" -n "$NS" --request-timeout=10s &>/dev/null || continue
    _lbip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.spec.loadBalancerIP}' --request-timeout=10s 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$_lbip" ]]; then
      kubectl patch svc "$svc" -n "$NS" --type=json \
        -p='[{"op":"remove","path":"/spec/loadBalancerIP"}]' --request-timeout=20s &>/dev/null \
        && echo "  stripped $svc (was $_lbip)" || echo "  ⚠️  could not remove spec.loadBalancerIP on $svc"
    else
      echo "  (no spec.loadBalancerIP on $svc — skip)"
    fi
    # Remove legacy MetalLB annotation only if present (avoids noisy apiserver errors).
    if kubectl get svc "$svc" -n "$NS" -o json --request-timeout=10s 2>/dev/null | grep -q 'metallb.universe.tf/loadBalancerIPs'; then
      kubectl annotate svc "$svc" -n "$NS" "metallb.universe.tf/loadBalancerIPs-" --request-timeout=15s &>/dev/null || true
    fi
  done
  echo "✅ strip complete (MetalLB will reassign EXTERNAL-IP on next reconcile)"
  exit 0
fi

if [[ "${KAFKA_SKIP_METALLB_EXTERNAL_PIN:-0}" == "1" ]]; then
  echo "ℹ️  patch-kafka-external-metallb-pinned-ips: KAFKA_SKIP_METALLB_EXTERNAL_PIN=1 — no-op"
  exit 0
fi

echo "ℹ️  patch-kafka-external-metallb-pinned-ips: IP pinning disabled (MetalLB allocator mode). No-op."
echo "   TLS: kafka-refresh-tls-from-lb.sh reads actual LB IPs. Recovery from old pins: STRIP_KAFKA_EXTERNAL_REQUESTED_LB_IP=1 $0"
exit 0
