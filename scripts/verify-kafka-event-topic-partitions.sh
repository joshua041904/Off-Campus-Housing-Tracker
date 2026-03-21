#!/usr/bin/env bash
# After create-kafka-event-topics.sh: verify each domain topic has EXPECTED partition count (default 6).
# Uses docker compose exec into the kafka service (SSL + client auth).
#
# Usage: ./scripts/verify-kafka-event-topic-partitions.sh
#   EXPECTED=6  ENV_PREFIX=dev  SKIP_KAFKA_VERIFY=1
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

EXPECTED="${EXPECTED:-6}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
SKIP_KAFKA_VERIFY="${SKIP_KAFKA_VERIFY:-0}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

TOPICS=(
  "${ENV_PREFIX}.booking.events"
  "${ENV_PREFIX}.listing.events"
  "${ENV_PREFIX}.trust.events"
  "${ENV_PREFIX}.auth.events"
  "${ENV_PREFIX}.analytics.events"
  "messaging.events.v1"
  "${ENV_PREFIX}.notification.events"
  "${ENV_PREFIX}.media.events"
)

if [[ "$SKIP_KAFKA_VERIFY" == "1" ]]; then
  warn "SKIP_KAFKA_VERIFY=1 — skipping live Kafka partition check"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found; skipping partition verify (install Docker or set SKIP_KAFKA_VERIFY=1)"
  exit 0
fi

if ! docker compose exec -T kafka true 2>/dev/null; then
  warn "Kafka container not reachable (docker compose exec kafka). Start infra or SKIP_KAFKA_VERIFY=1"
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
