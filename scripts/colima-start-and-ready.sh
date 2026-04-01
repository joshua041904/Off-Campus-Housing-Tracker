#!/usr/bin/env bash
# Bring Colima+k3s up with bridged networking and wait for API (no VM delete). Alias for colima-start-k3s-bridged.sh.
#
# Usage: ./scripts/colima-start-and-ready.sh
# Set COLIMA_NETWORK_ADDRESS=0 only if you intentionally want non-bridged Colima (MetalLB/host reachability differ).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/colima-start-k3s-bridged.sh"
