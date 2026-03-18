#!/usr/bin/env bash
# Capture API server and control-plane metrics (Colima k3s). Single snapshot or 3×10s apart.
# Usage:
#   ./scripts/capture-control-plane-telemetry.sh --once
#   ./scripts/capture-control-plane-telemetry.sh   # 3 snapshots, 10s apart
#   ./scripts/capture-control-plane-telemetry.sh --once > telemetry-$(date +%Y%m%d-%H%M%S).txt
# See docs/CONTROL_PLANE_TELEMETRY.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONCE=""
for arg in "$@"; do
  [[ "$arg" == "--once" ]] && ONCE=1
done

_snapshot() {
  local when
  when=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "=== control-plane telemetry @ $when ==="

  echo "--- readyz (verbose) ---"
  kubectl get --raw /readyz?verbose=1 2>/dev/null || echo "(readyz failed)"
  echo ""

  echo "--- healthz ---"
  kubectl get --raw /healthz 2>/dev/null || echo "(healthz failed)"
  echo ""

  echo "--- top nodes ---"
  kubectl top nodes 2>/dev/null || echo "(metrics-server not available)"
  echo ""

  echo "--- top pods (all namespaces) ---"
  kubectl top pods -A 2>/dev/null | head -80 || echo "(metrics-server not available)"
  echo ""

  echo "--- apiserver /metrics (sample) ---"
  kubectl get --raw /metrics 2>/dev/null | grep -E "^apiserver_current_inflight|^apiserver_request_duration_seconds_bucket|^etcd_" | head -30 || echo "(/metrics not enabled or failed)"
  echo ""
}

if [[ -n "$ONCE" ]]; then
  _snapshot
  exit 0
fi

# Three snapshots, 10s apart
for i in 1 2 3; do
  _snapshot
  [[ $i -lt 3 ]] && sleep 10
done
