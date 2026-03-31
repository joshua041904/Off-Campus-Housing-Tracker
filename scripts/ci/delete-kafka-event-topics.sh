#!/usr/bin/env bash
# Optional teardown: delete the same topic set as create-kafka-event-topics.sh (--if-exists).
# Uses identical env: ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_DOCKER_CONTAINER or KAFKA_DOCKER_COMPOSE_SERVICE.
#
# Example (CI container): KAFKA_DOCKER_CONTAINER=kafka-ci OCH_KAFKA_TOPIC_SUFFIX=... bash scripts/ci/delete-kafka-event-topics.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OCH_KAFKA_TOPICS_DELETE=1
exec bash "$SCRIPT_DIR/../create-kafka-event-topics.sh"
