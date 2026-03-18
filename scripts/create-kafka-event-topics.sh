#!/usr/bin/env bash
# Create the six domain event topics (${ENV_PREFIX}.{domain}.events) for the housing platform.
# Partition key = entity_id. Run when Kafka is up (e.g. after bring-up-external-infra.sh).
# Requires kafka-topics.sh on PATH or Kafka container. Uses KAFKA_SSL_PORT / host 29094 by default.
#
# Usage: ./scripts/create-kafka-event-topics.sh
#   ENV_PREFIX=dev             — topic prefix (default dev); use staging/prod for other envs
#   KAFKA_BOOTSTRAP=host:port  — override (default 127.0.0.1:29094 for Docker)
#   PARTITIONS=6               — partitions per topic (default 6)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_PREFIX="${ENV_PREFIX:-dev}"
KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-127.0.0.1:29094}"
PARTITIONS="${PARTITIONS:-6}"

# One topic per domain; no hardcoded env in topic names
EVENT_TOPICS="${ENV_PREFIX}.booking.events ${ENV_PREFIX}.listing.events ${ENV_PREFIX}.trust.events ${ENV_PREFIX}.auth.events ${ENV_PREFIX}.messaging.events ${ENV_PREFIX}.notification.events ${ENV_PREFIX}.media.events"
# DLQ topics for failed consumer processing (optional; create when consumers are wired)
DLQ_TOPICS="${ENV_PREFIX}.messaging.dlq"
TOPICS="$EVENT_TOPICS $DLQ_TOPICS"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Creating domain event topics (ENV_PREFIX=$ENV_PREFIX, bootstrap=$KAFKA_BOOTSTRAP, partitions=$PARTITIONS)"

if command -v kafka-topics.sh >/dev/null 2>&1; then
  for t in $TOPICS; do
    if kafka-topics.sh --bootstrap-server "$KAFKA_BOOTSTRAP" --list 2>/dev/null | grep -qx "$t"; then
      ok "Topic $t already exists"
    else
      kafka-topics.sh --bootstrap-server "$KAFKA_BOOTSTRAP" --create --topic "$t" --partitions "$PARTITIONS" --replication-factor 1 2>/dev/null && ok "Created $t" || warn "Create $t failed (SSL/auth may be required)"
    fi
  done
else
  warn "kafka-topics.sh not found. Create topics manually or run from Kafka container:"
  for t in $TOPICS; do
    echo "  kafka-topics.sh --bootstrap-server \$KAFKA_BOOTSTRAP --create --topic $t --partitions $PARTITIONS --replication-factor 1"
  done
fi

say "Done. Event topics: messages must be serialized EventEnvelope; partition key = entity_id (conversation_id for messaging.events). DLQ topics: failed envelopes for alerting/replay."
