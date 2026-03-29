#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=messaging
export GATEWAY_HEALTH_PATH=/api/messaging/healthz
export K8S_DEPLOY=messaging-service
export GRPC_PORT=50064
export GRPC_PROBE_SERVICE=messaging.v1.MessagingService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
