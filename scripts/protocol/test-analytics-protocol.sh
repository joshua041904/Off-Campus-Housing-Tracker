#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=analytics
export GATEWAY_HEALTH_PATH=/api/analytics/healthz
export K8S_DEPLOY=analytics-service
export GRPC_PORT=50067
export GRPC_PROBE_SERVICE=analytics.AnalyticsService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
