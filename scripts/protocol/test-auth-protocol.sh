#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=auth
export GATEWAY_HEALTH_PATH=/api/auth/healthz
export K8S_DEPLOY=auth-service
export GRPC_PORT=50061
export GRPC_PROBE_SERVICE=auth.AuthService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
