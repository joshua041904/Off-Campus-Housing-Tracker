#!/usr/bin/env bash
# Full reset: colima stop → delete VM → start with --network-address (bridged) + pinned k3s (same as team MetalLB flow).
# Delegates to colima-teardown-and-start.sh (tunnel + API wait included).
#
# Usage: ./scripts/colima-start-k3s-bridged-clean.sh
# Env: same as colima-teardown-and-start.sh (COLIMA_CPU, COLIMA_MEMORY, COLIMA_DISK, COLIMA_K3S_VERSION, POST_START_SLEEP, …)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/colima-teardown-and-start.sh"
