#!/usr/bin/env bash
# Ensure proto/events domain protos exist and match the Kafka topic contract (derived from proto list + explicit exceptions).
# RPC contracts live in repo-root proto/*.proto; event payloads live in proto/events/*.proto (envelope required on wire).
#
# Usage: ./scripts/verify-proto-events-topics.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVENTS_DIR="$REPO_ROOT/proto/events"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -d "$EVENTS_DIR" ]] || fail "Missing $EVENTS_DIR"

[[ -f "$EVENTS_DIR/envelope.proto" ]] || fail "Missing proto/events/envelope.proto (EventEnvelope is mandatory on Kafka)"
[[ -f "$EVENTS_DIR/messaging.proto" ]] || fail "Missing proto/events/messaging.proto"
[[ -f "$EVENTS_DIR/messaging/v1/messaging_events.proto" ]] || fail "Missing proto/events/messaging/v1/messaging_events.proto"

chmod +x "$SCRIPT_DIR/verify-proto-topic-alignment.sh" 2>/dev/null || true
"$SCRIPT_DIR/verify-proto-topic-alignment.sh" || exit 1

TOPIC_SCRIPT="$SCRIPT_DIR/create-kafka-event-topics.sh"
[[ -f "$TOPIC_SCRIPT" ]] || fail "Missing $TOPIC_SCRIPT"

# Partition contract: must stay aligned with create-kafka-event-topics.sh PARTITIONS default (6)
grep -q 'PARTITIONS:-6' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must default PARTITIONS to 6 (event-layer / k6 contract)"

# create-kafka-event-topics must source shared proto-derived topic list (drift guard)
grep -q 'och-kafka-event-topics-from-proto.sh' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must source scripts/lib/och-kafka-event-topics-from-proto.sh"

ok "proto/events ↔ Kafka contract OK (alignment + envelope + PARTITIONS=6 + shared topic builder)"
