#!/usr/bin/env bash
# Ensure the Kubernetes API is reachable from the host. Re-establishes tunnel if needed and retries.
# Use before any kubectl that must work (apply scripts, install-metallb, etc.).
# Prints cluster identity (one Colima node, context, server) so you know "which one" you're talking to.
#
# Usage: source ./scripts/ensure-k8s-api.sh   # then ensure_k8s_api; optional: ensure_k8s_api 1 (verbose)
#    or: ./scripts/ensure-k8s-api.sh          # exits 0 when API is ready, 1 after max retries

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SSH_CFG="${HOME}/.colima/_lima/colima/ssh.config"
PID_FILE="${HOME}/.colima/default/colima-6443-tunnel.pid"

# Default: 15s timeout per try, 12 retries, 8s sleep between. Total ~3 min max.
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-15}"
MAX_RETRIES="${MAX_RETRIES:-12}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-8}"

ensure_k8s_api() {
  local verbose="${1:-0}"
  local attempt=1

  while [[ $attempt -le $MAX_RETRIES ]]; do
    if kubectl get nodes --request-timeout="${REQUEST_TIMEOUT}s" >/dev/null 2>&1; then
      if [[ "$verbose" -eq 1 ]]; then
        echo "✅ API reachable (attempt $attempt). Cluster identity:"
        echo "   context: $(kubectl config current-context 2>/dev/null || echo '?')"
        echo "   server:  $(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo '?')"
        echo "   node(s): $(kubectl get nodes -o wide --no-headers 2>/dev/null | head -5 || echo '?')"
        echo "   (Single node named 'colima' = this Colima VM; one cluster only.)"
      fi
      return 0
    fi

    if [[ $attempt -eq 1 ]]; then
      # First failure: try to fix tunnel (stale port after k3s restart)
      if [[ -f "$SSH_CFG" ]] && command -v colima >/dev/null 2>&1 && colima status 2>&1 | grep -qi running; then
        pkill -f "ssh.*-L.*6443:127.0.0.1" 2>/dev/null || true
        rm -f "$PID_FILE" 2>/dev/null || true
        sleep 2
        "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
        sleep 3
      fi
    fi

    [[ $attempt -lt $MAX_RETRIES ]] && sleep "$SLEEP_BETWEEN"
    attempt=$((attempt + 1))
  done

  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$ctx" == *"k3d"* ]]; then
    echo "⚠️  API still unreachable after $MAX_RETRIES attempts (k3d). Wait for API after node restart, then: kubectl get nodes"
    echo "   Or re-run preflight; step 3c1 will wait for API to settle before MetalLB when on k3d."
  else
    echo "⚠️  API still unreachable after $MAX_RETRIES attempts. Run: ./scripts/colima-forward-6443.sh then kubectl get nodes"
  fi
  return 1
}

# When run as script (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ensure_k8s_api 1
  exit $?
fi
