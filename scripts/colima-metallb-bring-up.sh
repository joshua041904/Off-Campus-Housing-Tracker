#!/usr/bin/env bash
# After bridged Colima is running: tunnel API, ensure app namespaces, install MetalLB with pool on the VM /24.
# METALLB_POOL should usually be **unset** so install-metallb-colima.sh auto-detects from k3s node InternalIP / Colima eth0.
#
# Usage: ./scripts/colima-metallb-bring-up.sh
# Optional: METALLB_POOL=192.168.64.240-192.168.64.250  (only if auto-detect is wrong)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "MetalLB bring-up (bridged Colima style — pool follows VM subnet when METALLB_POOL is empty)"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required"; exit 1; }

say "Step 1/3: API tunnel + kubeconfig"
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true

say "Step 2/3: Namespaces (ingress-nginx, envoy-test, off-campus-housing-tracker)"
for ns in ingress-nginx envoy-test off-campus-housing-tracker; do
  if kubectl get namespace "$ns" --request-timeout=10s &>/dev/null; then
    ok "namespace $ns exists"
  else
    kubectl create namespace "$ns"
    ok "created namespace $ns"
  fi
done

say "Step 3/3: MetalLB (L2 pool)"
if [[ -n "${METALLB_POOL:-}" ]]; then
  echo "  Using METALLB_POOL=$METALLB_POOL (ensure this /24 matches: colima ssh -- ip -4 addr show eth0)"
else
  echo "  METALLB_POOL unset → auto-detect from node InternalIP / Colima eth0 (.240-.250 on that /24)"
fi
"$SCRIPT_DIR/install-metallb-colima.sh"

say "Done"
ok "MetalLB installed. Verify: kubectl -n metallb-system get ipaddresspool; make verify-network-coherence"
echo "  Full stack: make cluster  or  RESTORE_BACKUP_DIR=latest make dev-onboard"
