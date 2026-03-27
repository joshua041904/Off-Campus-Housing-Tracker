#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=media
export GATEWAY_HEALTH_PATH=/api/media/healthz
export K8S_DEPLOY=media-service
export GRPC_PORT=50068
export GRPC_PROBE_SERVICE=media.MediaService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
