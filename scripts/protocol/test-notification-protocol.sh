#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=notification
export GATEWAY_HEALTH_PATH=/api/notification/healthz
export K8S_DEPLOY=notification-service
export GRPC_PORT=50065
export GRPC_PROBE_SERVICE=notification.NotificationService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
