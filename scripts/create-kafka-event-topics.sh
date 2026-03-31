#!/usr/bin/env bash
# Create domain event topics for the housing platform (must stay aligned with proto/events/* and producers).
# Partition key = entity_id. Run after Kafka is ready (broker API up), before application services start.
#
# Isolation: when OCH_KAFKA_TOPIC_SUFFIX is set (e.g. GITHUB_RUN_ID), the same rules as
# ochKafkaTopicIsolationSuffix() in services/common/src/kafka.ts apply — appended to all prefixed
# topics except messaging.events.v1.
#
# TLS + mTLS: use KAFKA_DOCKER_CONTAINER (plain docker name, e.g. kafka-ci) or
# KAFKA_DOCKER_COMPOSE_SERVICE=kafka so kafka-topics runs inside the broker with JKS + --command-config.
# Host-only kafka-topics against SSL requires KAFKA_COMMAND_CONFIG pointing at a client properties file.
#
# Contract checks: ./scripts/verify-proto-events-topics.sh
#
# Usage: ./scripts/create-kafka-event-topics.sh
#   ENV_PREFIX=dev
#   KAFKA_BOOTSTRAP=<host:port>       — e.g. MetalLB :9094 for external broker (Compose broker removed)
#   For in-cluster KRaft use: ./scripts/create-kafka-event-topics-k8s.sh
#   PARTITIONS=6
#   OCH_KAFKA_TOPIC_SUFFIX=...       — optional CI/test isolation (matches services)
#   KAFKA_DOCKER_CONTAINER=kafka-ci  — CI Confluent container
#   KAFKA_DOCKER_COMPOSE_SERVICE=kafka — legacy; Compose kafka removed (use k8s script or KAFKA_DOCKER_CONTAINER)
#   OCH_KAFKA_TOPICS_DELETE=1         — delete the same topic set (--if-exists), then exit (optional CI/teardown)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_PREFIX="${ENV_PREFIX:-dev}"
# Default matches CI ephemeral broker (start-kafka-tls-ci.sh). Local KRaft: create-kafka-event-topics-k8s.sh
KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-127.0.0.1:29094}"
PARTITIONS="${PARTITIONS:-6}"
KAFKA_DOCKER_CONTAINER="${KAFKA_DOCKER_CONTAINER:-}"
KAFKA_DOCKER_COMPOSE_SERVICE="${KAFKA_DOCKER_COMPOSE_SERVICE:-}"
KAFKA_COMMAND_CONFIG="${KAFKA_COMMAND_CONFIG:-}"

och_topic_suffix() {
  local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  while [[ "$raw" == .* ]]; do raw="${raw#.}"; done
  if [[ -n "$raw" ]]; then
    printf '.%s' "$raw"
  fi
}

SUF="$(och_topic_suffix)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

# Topic names derived from proto/events/*.proto (+ explicit booking.events.v1 + messaging.dlq). See scripts/lib/och-kafka-event-topics-from-proto.sh
# shellcheck source=lib/och-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"
och_kafka_event_topics_fill || die "Could not build topic list from proto/events"
TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")

write_tls_props_in_docker() {
  local inner
  inner='TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-kafka-event-topics.props'
  if [[ -n "$KAFKA_DOCKER_CONTAINER" ]]; then
    docker exec "$KAFKA_DOCKER_CONTAINER" sh -c "$inner"
  elif [[ -n "$KAFKA_DOCKER_COMPOSE_SERVICE" ]]; then
    docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T "$KAFKA_DOCKER_COMPOSE_SERVICE" sh -c "$inner"
  else
    return 1
  fi
}

kafka_topics_bin() {
  if [[ -n "$KAFKA_DOCKER_CONTAINER" ]]; then
    docker exec "$KAFKA_DOCKER_CONTAINER" kafka-topics "$@"
  elif [[ -n "$KAFKA_DOCKER_COMPOSE_SERVICE" ]]; then
    docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T "$KAFKA_DOCKER_COMPOSE_SERVICE" kafka-topics "$@"
  elif command -v kafka-topics.sh >/dev/null 2>&1; then
    kafka-topics.sh "$@"
  elif command -v kafka-topics >/dev/null 2>&1; then
    kafka-topics "$@"
  else
    die "kafka-topics not found. Set KAFKA_DOCKER_CONTAINER or KAFKA_DOCKER_COMPOSE_SERVICE, or install Kafka CLI."
  fi
}

bootstrap_for_cli() {
  if [[ -n "$KAFKA_DOCKER_CONTAINER" || -n "$KAFKA_DOCKER_COMPOSE_SERVICE" ]]; then
    printf '%s' "localhost:9093"
  else
    printf '%s' "$KAFKA_BOOTSTRAP"
  fi
}

say "Creating domain event topics (ENV_PREFIX=$ENV_PREFIX, bootstrap=$(bootstrap_for_cli), PARTITIONS=$PARTITIONS, isolation_suffix='${SUF:-}')"

CONFIG_ARGS=()
if [[ -n "$KAFKA_DOCKER_CONTAINER" || -n "$KAFKA_DOCKER_COMPOSE_SERVICE" ]]; then
  write_tls_props_in_docker || die "Could not write TLS client config inside Kafka container (secrets mounted?)"
  CONFIG_ARGS=(--command-config /tmp/och-kafka-event-topics.props)
elif [[ -n "$KAFKA_COMMAND_CONFIG" ]]; then
  CONFIG_ARGS=(--command-config "$KAFKA_COMMAND_CONFIG")
fi

BS="$(bootstrap_for_cli)"

if [[ "${OCH_KAFKA_TOPICS_DELETE:-}" == "1" ]]; then
  say "OCH_KAFKA_TOPICS_DELETE=1 — deleting listed topics (best-effort, --if-exists)"
  for t in "${TOPICS[@]}"; do
    if kafka_topics_bin --bootstrap-server "$BS" "${CONFIG_ARGS[@]}" --delete --if-exists --topic "$t" 2>/dev/null; then
      ok "Deleted (or absent): $t"
    else
      ok "Skip delete $t (not supported or broker busy — non-fatal)"
    fi
  done
  exit 0
fi

for t in "${TOPICS[@]}"; do
  if kafka_topics_bin --bootstrap-server "$BS" "${CONFIG_ARGS[@]}" --create --if-not-exists \
    --topic "$t" --partitions "$PARTITIONS" --replication-factor 1; then
    ok "Ensured topic $t"
  else
    die "Failed to create topic $t (broker TLS/auth or --if-not-exists unsupported?)"
  fi
done

say "Waiting for metadata propagation on all topics (describe until PartitionCount matches)..."
for t in "${TOPICS[@]}"; do
  meta_ok=0
  for _i in $(seq 1 45); do
    out="$(kafka_topics_bin --bootstrap-server "$BS" "${CONFIG_ARGS[@]}" --describe --topic "$t" 2>/dev/null || true)"
    if echo "$out" | grep -q "PartitionCount: $PARTITIONS"; then
      meta_ok=1
      ok "Topic metadata visible: $t"
      break
    fi
    sleep 1
  done
  [[ "$meta_ok" == "1" ]] || die "Timeout waiting for metadata on $t"
done

say "Done. Event topics: EventEnvelope on wire; partition key = entity_id (conversation_id for messaging.events.v1). DLQ: ${ENV_PREFIX}.messaging.dlq."
