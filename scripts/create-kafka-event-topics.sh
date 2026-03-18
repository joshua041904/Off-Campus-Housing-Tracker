#!/usr/bin/env bash
# Create the six domain event topics (dev.*.events) for the housing platform.
# Partition key = entity_id. Run when Kafka is up (e.g. after bring-up-external-infra.sh).
# Requires kafka-topics.sh on PATH or Kafka container. Uses KAFKA_SSL_PORT / host 29094 by default.
#
# Usage: ./scripts/create-kafka-event-topics.sh
#   KAFKA_BOOTSTRAP=host:port  — override (default 127.0.0.1:29094 for Docker)
#   PARTITIONS=6              — partitions per topic (default 6)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-127.0.0.1:29094}"
PARTITIONS="${PARTITIONS:-6}"

TOPICS="dev.booking.events dev.listing.events dev.trust.events dev.auth.events dev.messaging.events dev.notification.events"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Creating domain event topics (bootstrap=$KAFKA_BOOTSTRAP, partitions=$PARTITIONS)"

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

say "Done. All messages on these topics must be serialized EventEnvelope (proto/events/envelope.proto)."
