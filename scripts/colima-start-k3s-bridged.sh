#!/usr/bin/env bash
# Start Colima + k3s with --network-address (bridged VM) if not already running; tunnel 127.0.0.1:6443; wait for API.
# Same networking model as historical MetalLB L2: LB IPs live on the VM subnet; pool auto-aligns via install-metallb-colima.sh.
#
# Usage: ./scripts/colima-start-k3s-bridged.sh
# Env: COLIMA_CPU, COLIMA_MEMORY, COLIMA_DISK (defaults 12 / 16 / 256), COLIMA_NETWORK_ADDRESS (default 1),
#      COLIMA_K3S_VERSION (default v1.29.6+k3s1; set empty to omit --kubernetes-version),
#      BRIDGED_API_WAIT max seconds for kubectl (default 180).
# For full VM wipe + start use: ./scripts/colima-start-k3s-bridged-clean.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

COLIMA_CPU="${COLIMA_CPU:-${CPU:-12}}"
COLIMA_MEMORY="${COLIMA_MEMORY:-${MEMORY:-16}}"
COLIMA_DISK="${COLIMA_DISK:-${DISK:-256}}"
COLIMA_NETWORK_ADDRESS="${COLIMA_NETWORK_ADDRESS:-1}"
COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
BRIDGED_API_WAIT="${BRIDGED_API_WAIT:-180}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

say "Colima bridged start ( --network-address + MetalLB-friendly VM subnet )"
info "  Resources: ${COLIMA_CPU} CPU, ${COLIMA_MEMORY}GiB RAM, ${COLIMA_DISK}GiB disk"
info "  COLIMA_NETWORK_ADDRESS=${COLIMA_NETWORK_ADDRESS}  k3s=${COLIMA_K3S_VERSION:-default profile}"

if colima status 2>/dev/null | grep -q Running; then
  ok "Colima already running"
else
  say "Starting Colima + Kubernetes…"
  _args=(start --with-kubernetes --vm-type vz --cpu "$COLIMA_CPU" --memory "$COLIMA_MEMORY" --disk "$COLIMA_DISK")
  [[ "$COLIMA_NETWORK_ADDRESS" == "1" ]] && _args+=(--network-address)
  [[ -n "${COLIMA_K3S_VERSION:-}" ]] && _args+=(--kubernetes-version "$COLIMA_K3S_VERSION")
  if ! colima "${_args[@]}" 2>&1; then
    _fb=(start --with-kubernetes --cpu "$COLIMA_CPU" --memory "$COLIMA_MEMORY" --disk "$COLIMA_DISK")
    [[ "$COLIMA_NETWORK_ADDRESS" == "1" ]] && _fb+=(--network-address)
    [[ -n "${COLIMA_K3S_VERSION:-}" ]] && _fb+=(--kubernetes-version "$COLIMA_K3S_VERSION")
    colima "${_fb[@]}" 2>&1
  fi
  ok "Colima started"
fi

say "Tunnel 127.0.0.1:6443 + kubeconfig"
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true

say "Wait for API (up to ${BRIDGED_API_WAIT}s)"
_start=$(date +%s)
while true; do
  if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    ok "API server ready — next: make cluster  or  ./scripts/colima-metallb-bring-up.sh"
    exit 0
  fi
  _now=$(date +%s)
  if [[ $((_now - _start)) -ge $BRIDGED_API_WAIT ]]; then
    echo "⚠️  API not ready after ${BRIDGED_API_WAIT}s — try: $SCRIPT_DIR/colima-forward-6443.sh --restart" >&2
    exit 1
  fi
  echo "  waiting… $((_now - _start))s / ${BRIDGED_API_WAIT}s"
  sleep 8
done
