#!/usr/bin/env bash
# Build every OCH backend image in HOUSING_DOCKER_SERVICES_DEFAULT, load into Colima Docker, and
# rollout restart each Deployment that exists in the namespace (transport-watchdog → api-gateway).
#
# End-to-end ship check (rollouts + Kafka + alignment): ./scripts/golden-snapshot-verify.sh or make golden-snapshot
#
# Usage (repo root, Colima running):
#   ./scripts/rebuild-all-housing-images-k3s.sh
#   ROLLOUT=0 ./scripts/rebuild-all-housing-images-k3s.sh   # build + load only
#   SKIP_LOAD=1 ./scripts/rebuild-all-housing-images-k3s.sh # build only
#
# Same env as rebuild-och-images-and-rollout.sh / build-housing-images-k3s.sh (IMAGE_TAG, DOCKER_DEFAULT_PLATFORM, …).
# Default: refresh app-config (three-broker KAFKA_BROKER) and scale each deploy to 1 after rollout (Colima dev).
#   APPLY_APP_CONFIG=0 SCALE_DEPLOY_REPLICAS=  ./scripts/rebuild-all-housing-images-k3s.sh  # build/load/rollout only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/och-housing-docker-services-default.sh
source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"

export SERVICES="$HOUSING_DOCKER_SERVICES_DEFAULT"
export APPLY_APP_CONFIG="${APPLY_APP_CONFIG:-1}"
export SCALE_DEPLOY_REPLICAS="${SCALE_DEPLOY_REPLICAS:-1}"
exec "$SCRIPT_DIR/rebuild-och-images-and-rollout.sh"
