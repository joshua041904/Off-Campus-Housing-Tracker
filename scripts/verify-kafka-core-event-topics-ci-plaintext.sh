#!/usr/bin/env bash
# GitHub Actions / local plaintext broker: ensure core domain event topics exist (create if missing) and describe.
# Default bootstrap: 127.0.0.1:9092, ENV_PREFIX=dev — matches integration-tests kafka-ci service.
set -euo pipefail

ENV_PREFIX="${ENV_PREFIX:-dev}"
BS="${KAFKA_BROKER:-127.0.0.1:9092}"
IMG="${KAFKA_TOOLS_IMAGE:-confluentinc/cp-kafka:7.5.0}"

topics=(
  "${ENV_PREFIX}.booking.events.v1"
  "${ENV_PREFIX}.community.events.v1"
  "${ENV_PREFIX}.trust.events.v1"
)

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker required (runs kafka-topics from $IMG with --network=host)" >&2
  exit 1
fi

kt() {
  docker run --rm --network=host "$IMG" kafka-topics --bootstrap-server "$BS" "$@"
}

for t in "${topics[@]}"; do
  echo "→ $t"
  kt --create --if-not-exists --topic "$t" --partitions 1 --replication-factor 1
  kt --describe --topic "$t" >/dev/null
  echo "  ✅ describe ok"
done

echo "✅ Core Kafka event topics on $BS (${#topics[@]} topics, prefix=$ENV_PREFIX)"
