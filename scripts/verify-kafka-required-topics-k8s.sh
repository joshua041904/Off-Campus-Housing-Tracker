#!/usr/bin/env bash
# Fail if required domain event topics are missing (SSL in-broker, same contract as create-kafka-event-topics-k8s.sh).
# KRaft: use :9093 + command-config only (see create-kafka-event-topics-k8s.sh header).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
export ENV_PREFIX="${ENV_PREFIX:-dev}"
# shellcheck source=lib/och-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"

NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"
KPOD="${KAFKA_K8S_POD:-kafka-0}"
KREQ=(--request-timeout="${KUBECTL_REQUEST_TIMEOUT:-120s}")

och_kafka_event_topics_fill || { echo "❌ Could not build topic list" >&2; exit 1; }

_inner_props='TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
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
} > /tmp/och-k8s-verify-topics.props'

kubectl "${KREQ[@]}" exec -n "$NS" "$KPOD" -- bash -ec "$_inner_props" || {
  echo "❌ Could not write TLS props in $KPOD" >&2
  exit 1
}

BS="${KAFKA_BOOTSTRAP_SERVER:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"

k8s_kafka_topics() {
  kubectl "${KREQ[@]}" exec -n "$NS" "$KPOD" -- kafka-topics --bootstrap-server "$BS" --command-config /tmp/och-k8s-verify-topics.props "$@"
}

missing=0
for t in "${OCH_KAFKA_EVENT_TOPICS[@]}"; do
  if ! k8s_kafka_topics --describe --topic "$t" >/dev/null 2>&1; then
    echo "❌ Missing or unreadable topic: $t" >&2
    missing=1
  else
    echo "✅ Topic present: $t"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "❌ One or more Kafka topics missing — run ./scripts/create-kafka-event-topics-k8s.sh" >&2
  exit 1
fi

echo "✅ All proto-derived Kafka topics present (${#OCH_KAFKA_EVENT_TOPICS[@]} topics)"
