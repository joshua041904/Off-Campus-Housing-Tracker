#!/usr/bin/env bash
# One-shot: create a new Colima + k3s cluster and install MetalLB (L2).
# Use after colima delete (or no Colima instance). Pool IP range is per-project to avoid conflicts.
#
# Usage:
#   ./scripts/setup-new-colima-cluster.sh
#   METALLB_POOL=192.168.64.251-192.168.64.260 ./scripts/setup-new-colima-cluster.sh   # e.g. housing (different range)
#
# Default METALLB_POOL=192.168.64.240-192.168.64.250 (off-campus-housing-tracker). For a second project on the same
# network (e.g. housing), set a different range (e.g. .251-.260) so LoadBalancer IPs do not clash.
#
# Env: CPU (default 12), MEMORY (default 16), DISK (default 256), METALLB_POOL, COLIMA_K3S_VERSION.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CPU="${CPU:-12}"
MEMORY="${MEMORY:-16}"
DISK="${DISK:-256}"
# Per-project: change this for housing or other projects to avoid IP conflict with off-campus-housing-tracker.
METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Step 1: Start Colima (${CPU} CPU, ${MEMORY} GiB RAM, ${DISK} GiB disk) with k3s"
if colima status 2>/dev/null | grep -q "Running"; then
  ok "Colima already running"
else
  colima start --cpu "$CPU" --memory "$MEMORY" --disk "${DISK}" --with-kubernetes ${COLIMA_K3S_VERSION:+--kubernetes-version "$COLIMA_K3S_VERSION"}
  ok "Colima started"
fi

say "Step 2: Wait for Kubernetes API (127.0.0.1:6443)"
for i in $(seq 1 60); do
  if kubectl get ns default --request-timeout=5s >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  [[ $i -eq 60 ]] && { warn "API not ready after 60 attempts"; exit 1; }
  sleep 5
done

# Ensure kubeconfig uses 127.0.0.1:6443 (Colima tunnel)
if [[ -f "$HOME/.kube/config" ]]; then
  if grep -q "127.0.0.1:6443" "$HOME/.kube/config" 2>/dev/null; then
    : "kubeconfig already points to 127.0.0.1:6443"
  else
    warn "If kubectl fails, run: export KUBECONFIG=\$HOME/.colima/default/kubeconfig or merge Colima kubeconfig"
  fi
fi

say "Step 3: Install MetalLB (L2 pool: $METALLB_POOL)"
export METALLB_POOL
"$SCRIPT_DIR/install-metallb.sh"
ok "MetalLB installed"

say "Done. Next: apply namespaces, TLS secrets, and Caddy (e.g. scripts/strict-tls-bootstrap.sh, scripts/rollout-caddy.sh, kubectl apply -k infra/k8s/overlays/dev). Or run scripts/ensure-ready-for-preflight.sh then scripts/run-preflight-scale-and-all-suites.sh."
