#!/usr/bin/env bash
# Static contract: every proto/events domain proto (except envelope) maps to the expected Kafka topic naming rules
# implemented in scripts/lib/och-kafka-event-topics-from-proto.sh. Fails on drift (new proto without wiring).
#
# Usage: ./scripts/verify-proto-topic-alignment.sh
#   ENV_PREFIX=dev  OCH_KAFKA_TOPIC_SUFFIX=   PROTO_EVENTS_ROOT=... (optional)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_PREFIX="${ENV_PREFIX:-dev}"
PROTO_EVENTS_ROOT="${PROTO_EVENTS_ROOT:-$REPO_ROOT/proto/events}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

SUF=""
raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"
raw="${raw#"${raw%%[![:space:]]*}"}"
raw="${raw%"${raw##*[![:space:]]}"}"
while [[ "$raw" == .* ]]; do raw="${raw#.}"; done
[[ -n "$raw" ]] && SUF=".${raw}"

# shellcheck source=lib/och-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"
och_kafka_event_topics_fill || fail "Could not build topic list from proto/events"

och_topic_list_contains() {
  local needle="$1" t
  for t in "${OCH_KAFKA_EVENT_TOPICS[@]}"; do
    [[ "$t" == "$needle" ]] && return 0
  done
  return 1
}

[[ -d "$PROTO_EVENTS_ROOT" ]] || fail "Missing $PROTO_EVENTS_ROOT"

for f in "$PROTO_EVENTS_ROOT"/*.proto; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f" .proto)
  [[ "$base" == "envelope" ]] && continue

  if [[ "$base" == "messaging" ]]; then
    och_topic_list_contains "messaging.events.v1" || fail "messaging.proto must map to topic messaging.events.v1"
  else
    exp="${ENV_PREFIX}.${base}.events${SUF}"
    och_topic_list_contains "$exp" || fail "Proto $base.proto expects Kafka topic '$exp' in derived topic set (got ${#OCH_KAFKA_EVENT_TOPICS[@]} topics)"
  fi
done

och_topic_list_contains "${ENV_PREFIX}.booking.events.v1${SUF}" || fail "Missing ${ENV_PREFIX}.booking.events.v1${SUF}"
och_topic_list_contains "${ENV_PREFIX}.messaging.dlq${SUF}" || fail "Missing ${ENV_PREFIX}.messaging.dlq${SUF}"

ok "proto/events ↔ Kafka topic naming contract OK (${#OCH_KAFKA_EVENT_TOPICS[@]} topics, ENV_PREFIX=$ENV_PREFIX)"
