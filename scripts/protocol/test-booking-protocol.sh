#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_KEY=booking
export GATEWAY_HEALTH_PATH=/api/booking/healthz
export K8S_DEPLOY=booking-service
export GRPC_PORT=50063
export GRPC_PROBE_SERVICE=booking.BookingService
exec bash "$SCRIPT_DIR/test-service-protocol.sh" "$@"
