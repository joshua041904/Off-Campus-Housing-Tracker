#!/usr/bin/env bash
# Compare kafka-N-external LoadBalancer IPs to EXTERNAL:// in each broker's advertised.listeners
# (from /etc/kafka/kafka.properties). Human-friendly table + exit 1 on any mismatch.
#
# Usage:
#   ./scripts/check-kafka-config-drift.sh [namespace] [replicas]
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_CLUSTER_EXEC_TIMEOUT
#
# Optional: DRIFT_WRITE_PROM_FILE=/path/to/file.prom — append OpenMetrics lines (for node_exporter textfile)
set -euo pipefail

NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"
EXEC_TO="${KAFKA_CLUSTER_EXEC_TIMEOUT:-45}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

say "Kafka config drift: LB Service IP vs broker advertised EXTERNAL (ns=$NS replicas=$REPLICAS)"

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

extract_external_ip() {
  # advertised.listeners=INTERNAL://...,EXTERNAL://x.x.x.x:9094
  local line="$1"
  if [[ "$line" =~ EXTERNAL://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+):9094 ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo ""
  fi
}

fail=0
stamp="$(date +%s)"
lines=()
drift_metric_lines=()

for ((i = 0; i < REPLICAS; i++)); do
  pod="kafka-${i}"
  svc="kafka-${i}-external"
  if ! kubectl get pod "$pod" -n "$NS" --request-timeout=20s &>/dev/null; then
    bad "Pod $pod not found"
    fail=1
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 1")
    continue
  fi
  lb_ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
  [[ -n "$lb_ip" ]] || lb_ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr -d '\r' || true)"

  line="$(kubectl exec -n "$NS" "$pod" -c kafka --request-timeout="${EXEC_TO}s" -- \
    grep -E '^advertised\.listeners=' /etc/kafka/kafka.properties 2>/dev/null | head -1 || true)"
  ext_ip="$(extract_external_ip "$line")"

  if [[ -z "$lb_ip" ]]; then
    bad "$pod: Service $svc has no LB ingress yet"
    fail=1
    lines+=("kafka_external_listener_matches_lb{broker=\"${i}\"} 0")
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 1")
    continue
  fi
  if [[ ! "$lb_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    bad "$pod: LB is non-IPv4 ($lb_ip) — drift check expects IPv4 EXTERNAL advert"
    fail=1
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 1")
    continue
  fi
  if [[ -z "$ext_ip" ]]; then
    bad "$pod: could not parse EXTERNAL IP from: ${line:-<empty>}"
    fail=1
    lines+=("kafka_external_listener_matches_lb{broker=\"${i}\"} 0")
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 1")
    continue
  fi

  printf "  broker %s: LB=%s advertised EXTERNAL=%s\n" "$i" "$lb_ip" "$ext_ip"
  if [[ "$lb_ip" != "$ext_ip" ]]; then
    bad "$pod: DRIFT lb_ip=$lb_ip != advertised $ext_ip"
    fail=1
    lines+=("kafka_external_listener_matches_lb{broker=\"${i}\"} 0")
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 1")
  else
    ok "$pod: LB matches advertised EXTERNAL"
    lines+=("kafka_external_listener_matches_lb{broker=\"${i}\"} 1")
    drift_metric_lines+=("kafka_runtime_config_drift{broker=\"${i}\"} 0")
  fi
done

drift=0
[[ "$fail" -ne 0 ]] && drift=1

if [[ -n "${DRIFT_WRITE_PROM_FILE:-}" ]]; then
  {
    echo "# HELP kafka_external_listener_matches_lb 1 if kafka-N-external LB IP equals EXTERNAL in advertised.listeners"
    echo "# TYPE kafka_external_listener_matches_lb gauge"
    printf '%s\n' "${lines[@]}"
    echo "# HELP kafka_runtime_config_drift 1 if broker EXTERNAL advert or LB state is out of sync (per broker)"
    echo "# TYPE kafka_runtime_config_drift gauge"
    printf '%s\n' "${drift_metric_lines[@]}"
    echo "# HELP kafka_metallb_advertised_lb_drift 1 if any broker LB != advertised EXTERNAL"
    echo "# TYPE kafka_metallb_advertised_lb_drift gauge"
    echo "kafka_metallb_advertised_lb_drift $drift"
  } >>"$DRIFT_WRITE_PROM_FILE"
  echo "Wrote metrics to $DRIFT_WRITE_PROM_FILE"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "Fix: ./scripts/kafka-sync-metallb.sh  (or KAFKA_SSL_EXTRA_IP_SANS=… ./scripts/kafka-ssl-from-dev-root.sh && kubectl rollout restart statefulset/kafka -n $NS)" >&2
  exit 1
fi

ok "No drift: all EXTERNAL advertised IPs match per-broker LoadBalancer Services"
exit 0
