#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=trust
export GATEWAY_HEALTH_PATH=/api/trust/healthz
export K8S_DEPLOY=trust-service
export GRPC_PORT=50066
export GRPC_PROBE_SERVICE=trust.TrustService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
