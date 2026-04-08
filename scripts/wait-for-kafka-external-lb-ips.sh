#!/usr/bin/env bash
# Wait until kafka-0..N-1-external each have status.loadBalancer.ingress[0].ip (MetalLB / cloud LB).
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_LB_WAIT_MAX_ATTEMPTS (default 90), KAFKA_LB_WAIT_SLEEP (default 2)
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
MAX="${KAFKA_LB_WAIT_MAX_ATTEMPTS:-90}"
SLEEP="${KAFKA_LB_WAIT_SLEEP:-2}"

echo "Waiting for kafka-0..$((REP - 1))-external LoadBalancer IPs in $NS (max ${MAX} attempts × ${SLEEP}s)..."
for ((i = 0; i < REP; i++)); do
  svc="kafka-${i}-external"
  found=""
  for ((a = 1; a <= MAX; a++)); do
    ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "  ✅ $svc → $ip"
      found=1
      break
    fi
    hn="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$hn" ]]; then
      echo "  ✅ $svc → $hn (hostname)"
      found=1
      break
    fi
    sleep "$SLEEP"
  done
  if [[ -z "$found" ]]; then
    echo "❌ Timed out waiting for EXTERNAL-IP on $svc"
    kubectl get svc "$svc" -n "$NS" -o wide 2>/dev/null || true
    exit 1
  fi
done
echo "✅ All kafka-*-external services have LoadBalancer endpoints"
