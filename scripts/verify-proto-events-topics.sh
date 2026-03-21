#!/usr/bin/env bash
# Ensure proto/events domain protos exist for every Kafka domain topic in create-kafka-event-topics.sh.
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

# Domain names embedded in topic tokens: dev.booking.events → booking
# messaging.events.v1 → messaging (special)
required_protos=(booking listing trust auth analytics notification media)

for domain in "${required_protos[@]}"; do
  f="$EVENTS_DIR/${domain}.proto"
  [[ -f "$f" ]] || fail "Missing event proto for domain '$domain': $f"
done

[[ -f "$EVENTS_DIR/envelope.proto" ]] || fail "Missing proto/events/envelope.proto (EventEnvelope is mandatory on Kafka)"
[[ -f "$EVENTS_DIR/messaging.proto" ]] || fail "Missing proto/events/messaging.proto"
[[ -f "$EVENTS_DIR/messaging/v1/messaging_events.proto" ]] || fail "Missing proto/events/messaging/v1/messaging_events.proto"

# create-kafka-event-topics.sh must mention each domain topic (sanity grep)
TOPIC_SCRIPT="$SCRIPT_DIR/create-kafka-event-topics.sh"
[[ -f "$TOPIC_SCRIPT" ]] || fail "Missing $TOPIC_SCRIPT"
grep -q 'listing\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define listing.events topic"
grep -q 'trust\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define trust.events topic"
grep -q 'booking\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define booking.events topic"
grep -q 'auth\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define auth.events topic"
grep -q 'messaging\.events\.v1' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define messaging.events.v1 topic"
grep -q 'notification\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define notification.events topic"
grep -q 'media\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define media.events topic"
grep -q 'analytics\.events' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must define analytics.events topic"

# Partition contract: must stay aligned with create-kafka-event-topics.sh PARTITIONS default (6)
grep -q 'PARTITIONS:-6' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must default PARTITIONS to 6 (event-layer / k6 contract)"

ok "proto/events aligns with Kafka domain topics (see scripts/create-kafka-event-topics.sh); PARTITIONS default=6"
