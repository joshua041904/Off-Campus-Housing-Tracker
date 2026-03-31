#!/usr/bin/env bash
# Verify each KRaft broker's effective advertised.listeners matches:
#   INTERNAL://kafka-N.kafka.<ns>.svc.cluster.local:9093
#   EXTERNAL://<kafka-N-external LoadBalancer IP>:9094
# Reads /etc/kafka/kafka.properties inside the broker pod (post-configure).
#
# Usage:
#   ./scripts/verify-kafka-kraft-advertised-listeners.sh [namespace] [replicas]
# Env:
#   HOUSING_NS / namespace arg
#   KAFKA_BROKER_REPLICAS / replicas arg
#   KAFKA_ADVERTISED_VERIFY_TIMEOUT — kubectl exec timeout seconds (default 25)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"
EXEC_TO="${KAFKA_ADVERTISED_VERIFY_TIMEOUT:-25}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

say "Kafka KRaft advertised.listeners + MetalLB alignment (ns=$NS replicas=$REPLICAS)"

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

fail=0
for ((i = 0; i < REPLICAS; i++)); do
  pod="kafka-${i}"
  svc="kafka-${i}-external"
  internal_fqdn="${pod}.kafka.${NS}.svc.cluster.local"
  want_internal="INTERNAL://${internal_fqdn}:9093"

  if ! kubectl get pod "$pod" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
    bad "Pod $pod not found in $NS"
    fail=1
    continue
  fi

  lb_ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  [[ -n "$lb_ip" ]] || lb_ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  if [[ -z "$lb_ip" ]]; then
    bad "Service $svc has no LoadBalancer ingress yet (need MetalLB IP for EXTERNAL listener)"
    fail=1
    continue
  fi
  # Hostname-style LB (e.g. AWS); advertised uses IP in our StatefulSet — hostname would mismatch; flag clearly.
  if [[ ! "$lb_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    bad "Service $svc LB is hostname '$lb_ip' — this check expects IPv4 EXTERNAL advertisement; adjust script or use IP LB"
    fail=1
    continue
  fi

  want_external="EXTERNAL://${lb_ip}:9094"
  line="$(kubectl exec -n "$NS" "$pod" -c kafka --request-timeout="${EXEC_TO}s" -- \
    grep -E '^advertised\.listeners=' /etc/kafka/kafka.properties 2>/dev/null | head -1 || true)"
  if [[ -z "$line" ]]; then
    bad "$pod: no advertised.listeners= in /etc/kafka/kafka.properties (broker not configured yet?)"
    fail=1
    continue
  fi

  if [[ "$line" != *"$internal_fqdn"* ]]; then
    bad "$pod: expected INTERNAL host $internal_fqdn in: $line"
    fail=1
  else
    ok "$pod: INTERNAL advert includes $internal_fqdn"
  fi

  if [[ "$line" != *"${lb_ip}:9094"* ]]; then
    bad "$pod: expected EXTERNAL ${lb_ip}:9094 in: $line (Service $svc)"
    fail=1
  else
    ok "$pod: EXTERNAL advert includes ${lb_ip}:9094 ($svc)"
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "Hints: kubectl logs kafka-0 -n $NS -c kafka | grep KAFKA_ADVERTISED_LISTENERS" >&2
  echo "  Re-apply StatefulSet + rollout restart statefulset/kafka -n $NS" >&2
  echo "  Certs: KAFKA_SSL_EXTRA_IP_SANS=<ips> ./scripts/kafka-ssl-from-dev-root.sh" >&2
  exit 1
fi

ok "All $REPLICAS brokers: advertised.listeners match headless FQDN + per-broker external LB IP"
