#!/usr/bin/env bash
# After topic create: verify each domain topic has EXPECTED partition count (default 6).
# Targets:
#   KAFKA_PARTITION_VERIFY_TARGET=k8s — kubectl exec into kafka-0 (TLS to kafka-0.kafka:9093)
#   default / compose — docker compose exec kafka (removed from repo; use k8s)
#
# Usage: ./scripts/verify-kafka-event-topic-partitions.sh
#   EXPECTED=6  ENV_PREFIX=dev  SKIP_KAFKA_VERIFY=1
#   STRICT_KAFKA_PARTITION_VERIFY=1 — strict path must reach a broker (k8s or legacy compose)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

EXPECTED="${EXPECTED:-6}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
SKIP_KAFKA_VERIFY="${SKIP_KAFKA_VERIFY:-0}"
STRICT_KAFKA_PARTITION_VERIFY="${STRICT_KAFKA_PARTITION_VERIFY:-0}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

SUF=""
och_topic_suffix_partitions() {
  local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  while [[ "$raw" == .* ]]; do raw="${raw#.}"; done
  if [[ -n "$raw" ]]; then printf '.%s' "$raw"; fi
}
SUF="$(och_topic_suffix_partitions)"
# shellcheck source=lib/och-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"
och_kafka_event_topics_fill || fail "Could not build topic list from proto/events"
TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")

if [[ "$SKIP_KAFKA_VERIFY" == "1" ]]; then
  warn "SKIP_KAFKA_VERIFY=1 — skipping live Kafka partition check"
  exit 0
fi

if [[ "${KAFKA_PARTITION_VERIFY_TARGET:-}" == "k8s" ]]; then
  command -v kubectl >/dev/null 2>&1 || fail "kubectl required for KAFKA_PARTITION_VERIFY_TARGET=k8s"
  _ns="${KAFKA_K8S_NS:-off-campus-housing-tracker}"
  _pod="${KAFKA_K8S_POD:-kafka-0}"
  kubectl get pod "$_pod" -n "$_ns" --request-timeout=20s >/dev/null 2>&1 || fail "Pod $_pod not in $_ns"
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
} > /tmp/och-kafka-verify.props'
  kubectl exec -n "$_ns" "$_pod" -- bash -ec "$_inner_props" || fail "Could not write TLS props in $_pod"
  _bs="kafka-0.kafka:9093"
  for t in "${TOPICS[@]}"; do
    out="$(kubectl exec -n "$_ns" "$_pod" -- kafka-topics --bootstrap-server "$_bs" --command-config /tmp/och-kafka-verify.props --describe --topic "$t" 2>/dev/null | head -8 || true)"
    if echo "$out" | grep -q "PartitionCount: $EXPECTED"; then
      ok "$t → PartitionCount: $EXPECTED"
    elif echo "$out" | grep -q "PartitionCount:"; then
      fail "$t: expected PartitionCount: $EXPECTED, got: $out"
    elif echo "$out" | grep -qi "UnknownTopic"; then
      fail "$t: topic missing — run ./scripts/create-kafka-event-topics-k8s.sh"
    else
      fail "$t: could not describe topic. Output: $out"
    fi
  done
  ok "All listed event topics have $EXPECTED partitions (k8s)"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  if [[ "$STRICT_KAFKA_PARTITION_VERIFY" == "1" ]]; then
    fail "docker required for partition verify (STRICT_KAFKA_PARTITION_VERIFY=1)"
  fi
  warn "docker not found; skipping partition verify (install Docker or set SKIP_KAFKA_VERIFY=1)"
  exit 0
fi

if ! docker compose exec -T kafka true 2>/dev/null; then
  if [[ "$STRICT_KAFKA_PARTITION_VERIFY" == "1" ]]; then
    fail "Kafka compose service not present (removed). Use KAFKA_PARTITION_VERIFY_TARGET=k8s or deploy KRaft brokers."
  fi
  warn "No docker compose Kafka — use in-cluster Kafka + KAFKA_PARTITION_VERIFY_TARGET=k8s or SKIP_KAFKA_VERIFY=1"
  exit 0
fi

_props_in_container() {
  docker compose exec -T kafka sh -c '
    TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
    KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
    KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
    {
      echo "security.protocol=SSL"
      echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
      echo "ssl.truststore.password=${TS_PASS}"
      echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
      echo "ssl.keystore.password=${KS_PASS}"
      echo "ssl.key.password=${KP_PASS}"
    } > /tmp/och-kafka-verify.props
  '
}

_partition_for_topic() {
  local t="$1"
  docker compose exec -T kafka env "KAFKA_TOPIC=$t" sh -c '
    kafka-topics --bootstrap-server localhost:9093 --command-config /tmp/och-kafka-verify.props --describe --topic "$KAFKA_TOPIC" 2>/dev/null | head -8
  '
}

_props_in_container

for t in "${TOPICS[@]}"; do
  out=$(_partition_for_topic "$t" || true)
  if echo "$out" | grep -q "PartitionCount: $EXPECTED"; then
    ok "$t → PartitionCount: $EXPECTED"
  elif echo "$out" | grep -q "PartitionCount:"; then
    fail "$t: expected PartitionCount: $EXPECTED, got: $out"
  elif echo "$out" | grep -qi "UnknownTopic"; then
    fail "$t: topic missing — run ENV_PREFIX=$ENV_PREFIX ./scripts/create-kafka-event-topics.sh"
  else
    fail "$t: could not describe topic (SSL or broker). Output: $out"
  fi
done

ok "All listed event topics have $EXPECTED partitions"
