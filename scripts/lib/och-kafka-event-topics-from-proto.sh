#!/usr/bin/env bash
# Shared: derive OCH_KAFKA_EVENT_TOPICS from proto/events/*.proto (single source of truth with explicit exceptions).
# Sourced by create-kafka-event-topics.sh, verify-kafka-event-topic-partitions.sh, verify-proto-topic-alignment.sh.
#
# Requires before call:
#   REPO_ROOT, ENV_PREFIX, SUF (isolation suffix; same rules as ochKafkaTopicIsolationSuffix() in services/common/src/kafka.ts)
#
# On success sets:
#   OCH_KAFKA_EVENT_TOPICS — bash array of topic names (sorted unique)
#
# Rules:
#   - One top-level proto/events/<stem>.proto (except envelope.proto) → "${ENV_PREFIX}.<stem>.events${SUF}"
#   - messaging.proto → messaging.events.v1 only (no env prefix; no isolation suffix; matches producers)
#   - Always add "${ENV_PREFIX}.booking.events.v1${SUF}" (gRPC path; in addition to dev.booking.events from booking.proto)
#   - Always add "${ENV_PREFIX}.messaging.dlq${SUF}"

och_kafka_event_topics_fill() {
  OCH_KAFKA_EVENT_TOPICS=()
  local proto_root="${PROTO_EVENTS_ROOT:-$REPO_ROOT/proto/events}"
  if [[ ! -d "$proto_root" ]]; then
    echo "❌ Proto events directory not found: $proto_root" >&2
    return 1
  fi

  local f base
  local names_raw=""
  for f in "$proto_root"/*.proto; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f" .proto)
    [[ "$base" == "envelope" ]] && continue
    names_raw+="$base"$'\n'
  done

  local sorted_names
  sorted_names=$(printf '%s' "$names_raw" | grep -v '^$' | LC_ALL=C sort -u) || true

  local tmp_topics=()
  while IFS= read -r base || [[ -n "$base" ]]; do
    [[ -z "$base" ]] && continue
    if [[ "$base" == "messaging" ]]; then
      tmp_topics+=("messaging.events.v1")
    else
      tmp_topics+=("${ENV_PREFIX}.${base}.events${SUF}")
    fi
  done <<<"$sorted_names"

  tmp_topics+=("${ENV_PREFIX}.booking.events.v1${SUF}")
  tmp_topics+=("${ENV_PREFIX}.messaging.dlq${SUF}")
  # Account lifecycle (deletion / anonymization); envelope payloads in proto/events/auth.proto
  tmp_topics+=("${ENV_PREFIX}.user.lifecycle.v1${SUF}")
  tmp_topics+=("${ENV_PREFIX}.user.lifecycle.ack.v1${SUF}")

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    OCH_KAFKA_EVENT_TOPICS+=("$line")
  done < <(printf '%s\n' "${tmp_topics[@]}" | LC_ALL=C sort -u)
}
