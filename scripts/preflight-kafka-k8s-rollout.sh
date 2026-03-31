#!/usr/bin/env bash
# Pre-flight before rolling out Kafka-producing services on KRaft k8s:
# broker safety props, DNS/slice check, ensure proto-derived topics (RF=3, min.insync.replicas=2 on create).
#
# Usage: ./scripts/preflight-kafka-k8s-rollout.sh
# Env: KAFKA_K8S_NS, KAFKA_K8S_POD, KAFKA_K8S_SKIP_API_HEALTH=1 — same as create-kafka-event-topics-k8s.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"
KPOD="${KAFKA_K8S_POD:-kafka-0}"
BS="kafka-0.kafka:9093"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

say "1) Broker /etc/kafka/kafka.properties (safety)"
kubectl exec -n "$NS" "$KPOD" -- grep -E '^(min\.insync\.replicas|default\.replication\.factor|auto\.create\.topics\.enable)=' /etc/kafka/kafka.properties 2>/dev/null \
  || echo "WARN: could not read kafka.properties (is $KPOD Running?)" >&2

say "2) Headless DNS vs EndpointSlices"
bash "$SCRIPT_DIR/validate-kafka-dns.sh" || exit 1

say "3) Ensure event topics (proto-derived, RF=3, PARTITIONS=6, topic min.insync.replicas=2)"
export KAFKA_K8S_SKIP_API_HEALTH="${KAFKA_K8S_SKIP_API_HEALTH:-1}"
bash "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh"

write_props='TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.endpoint.identification.algorithm="
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-pf.props'

say "4) Topic list (first 25 names)"
kubectl exec -n "$NS" "$KPOD" -- bash -ec "$write_props
kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | head -25
echo --- total: \$(kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | wc -l | tr -d \" \") topics ---
"

say "5) Describe sample topic (ReplicationFactor + ISR)"
SAMPLE_TOPIC="${PREFLIGHT_SAMPLE_TOPIC:-dev.listing.events}"
if kubectl exec -n "$NS" "$KPOD" -- bash -ec "$write_props
kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --describe --topic $SAMPLE_TOPIC" 2>/dev/null; then
  :
else
  echo "Could not describe $SAMPLE_TOPIC (pick first topic)..."
  ft="$(kubectl exec -n "$NS" "$KPOD" -- bash -ec "$write_props
kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | head -1")"
  if [[ -n "$ft" ]]; then
    kubectl exec -n "$NS" "$KPOD" -- bash -ec "$write_props
kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --describe --topic \"$ft\""
  fi
fi

say "Pre-flight complete. Roll out services one at a time; watch kafka-0 logs and quorum CronJob."
