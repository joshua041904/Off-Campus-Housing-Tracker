#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=listings
export GATEWAY_HEALTH_PATH=/api/listings/healthz
export K8S_DEPLOY=listings-service
export GRPC_PORT=50062
export GRPC_PROBE_SERVICE=listings.ListingsService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
