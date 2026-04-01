#!/usr/bin/env bash
# Remove Kafka LoadBalancer Services + headless Service (and slices) so the next apply-kafka-kraft gets
# fresh MetalLB allocations and clean headless DNS. Use in dev-onboard before apply-kafka-kraft.
#
# Env: HOUSING_NS (default off-campus-housing-tracker)
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"

echo "=== kafka-onboarding-reset (ns=$NS) ==="
echo "Deleting kafka-0/1/2-external LoadBalancers and headless kafka Service (recreated by apply-kafka-kraft)..."
for s in kafka-0-external kafka-1-external kafka-2-external; do
  kubectl delete svc "$s" -n "$NS" --ignore-not-found --request-timeout=30s
done
kubectl delete svc kafka -n "$NS" --ignore-not-found --request-timeout=30s
kubectl delete endpoints kafka -n "$NS" --ignore-not-found --request-timeout=30s 2>/dev/null || true
kubectl delete endpointslices -n "$NS" -l kubernetes.io/service-name=kafka --ignore-not-found --request-timeout=30s 2>/dev/null || true
echo "✅ Kafka external + headless Service resources cleared. Next: kubectl apply -k infra/k8s/kafka-kraft-metallb/"
