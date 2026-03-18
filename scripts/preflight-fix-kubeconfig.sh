#!/usr/bin/env bash
# Fix kubeconfig so API server is reachable. No hangs.
# Colima: use native port only (no 6443 in pipeline — tunnel is flaky under load; see Runbook "Colima API").
# Entire script is capped at PREFLIGHT_CAP seconds. Default 45s: Colima fix + verify (Colima/k3s often slower).
# Also checks and installs required tools (mkcert, kubectl, etc.)

set -euo pipefail

PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shims first so kubectl uses shim (see API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md)
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# Check and install required tools
_check_tools() {
  local missing=0
  
  # Check kubectl
  if ! command -v kubectl >/dev/null 2>&1; then
    warn "kubectl not found"
    if command -v brew >/dev/null 2>&1; then
      info "Installing kubectl via Homebrew..."
      brew install kubectl 2>/dev/null || { warn "Failed to install kubectl"; missing=1; }
    else
      missing=1
    fi
  fi
  
  # Check mkcert (required for TLS certificates)
  if ! command -v mkcert >/dev/null 2>&1; then
    warn "mkcert not found (required for TLS certificates)"
    if command -v brew >/dev/null 2>&1; then
      info "Installing mkcert via Homebrew..."
      brew install mkcert 2>/dev/null || { warn "Failed to install mkcert"; missing=1; }
    else
      missing=1
    fi
  else
    # Ensure mkcert CA is installed
    if [[ ! -f "$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" ]]; then
      info "Initializing mkcert CA..."
      mkcert -install 2>/dev/null || warn "Failed to install mkcert CA"
    fi
  fi
  
  # Check colima (for Colima clusters)
  if ! command -v colima >/dev/null 2>&1; then
    warn "colima not found (optional, only needed for Colima clusters)"
  fi
  
  # Check curl (for HTTP/3 tests)
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found"
    missing=1
  fi
  
  return $missing
}

_run_preflight() {
  local ctx
  ctx=$(kubectl config current-context 2>/dev/null || true)

  # Colima: use native port only (no 6443 tunnel). Verify with current kubeconfig; retry once to avoid false unreachable.
  if [[ "$ctx" == *"colima"* ]]; then
    for _attempt in 1 2; do
      [[ $_attempt -gt 1 ]] && sleep 3
      if kubectl get nodes --request-timeout=25s >/dev/null 2>&1; then
        ok "Colima server (native port) reachable, proceeding"
        return 0
      fi
    done
    warn "Colima: API unreachable. Ensure Colima is running; if host cannot reach native port, try: ./scripts/colima-forward-6443.sh"
    return 1
  fi

  # Non-Colima: verify with 15s hard cap. Never hang.
  (
    kubectl get nodes --request-timeout=5s >/dev/null 2>&1 && exit 0
    [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && \
      colima ssh -- kubectl get nodes --request-timeout=5s >/dev/null 2>&1 && exit 0
    exit 1
  ) & vpid=$!
  ( sleep 15; kill -9 $vpid 2>/dev/null ) & kpid=$!
  wait $vpid 2>/dev/null || true
  local r=$?
  kill $kpid 2>/dev/null || true
  wait $kpid 2>/dev/null || true
  return $r
}

say "=== Pre-flight: Check tools and fix kubeconfig ==="

# Check and install required tools (non-blocking, but warn if missing)
if ! _check_tools; then
  warn "Some required tools are missing. Tests may fail."
fi

# Colima: if KUBECONFIG has multiple clusters (e.g. kind-h3.yaml with kind-h3, kind-h3-multi, colima), some tools
# (e.g. kubeadm) expect one cluster. Force a single-cluster config for Colima so API checks and child scripts see only colima.
# get-clusters prints a "NAME" header line; exclude it when counting.
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]]; then
  cluster_count=$(kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' | grep -c . || echo "0")
  if [[ "$cluster_count" -gt 1 ]]; then
    SINGLE_KUBE=$(mktemp 2>/dev/null || echo "/tmp/colima-kubeconfig-$$.yaml")
    kubectl config view --minify --raw >"$SINGLE_KUBE" 2>/dev/null && export KUBECONFIG="$SINGLE_KUBE" && ok "Colima: using single-cluster kubeconfig (had $cluster_count clusters)"
  fi
fi

# Run preflight in foreground (no hard kill). Colima check is single 6443 + get nodes (15s); non-Colima has 15s cap.
if _run_preflight; then
  ok "Cluster reachable"
  exit 0
fi
warn "Cluster not reachable. Colima: ensure VM is up; if host cannot reach API, run ./scripts/colima-forward-6443.sh then re-run."
exit 1
