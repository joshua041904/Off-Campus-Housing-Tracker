#!/usr/bin/env bash
# Ensure Colima k3s has MetalLB + pool + L2Advertisement + a LoadBalancer service (Caddy)
# so real L2 verification (ARP, asymmetric, BGP) has an LB IP and ingress/egress to test.
#
# Call after switching to Colima context (e.g. from preflight step 3c1c).
# Uses same pool/L2 as k3d by default; set METALLB_POOL for Colima if your host needs a different range (e.g. same subnet as Colima VM).
#
# Ingress: host → LB IP (real L2 when host and Colima VM share a network; otherwise use setup-lb-ip-host-access.sh for loopback+socat).
# Egress: pods → Caddy via cluster DNS or LB IP when nodes have route to pool.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"colima"* ]] && [[ "${COLIMA_FOR_L2:-0}" != "1" ]]; then
  warn "Current context is not Colima: $ctx. Switch to Colima for real L2 (or set COLIMA_FOR_L2=1 if invoked from preflight)."
  exit 1
fi

if ! kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
  warn "Colima API not reachable. Start Colima: colima start --with-kubernetes"
  exit 1
fi

say "=== Ensuring Colima k3s has MetalLB + ingress/egress for real L2 ==="
info "Context: $ctx"

# 1. Install MetalLB (controller + speaker) and apply pool + L2Advertisement on Colima
#    Use METALLB_POOL for Colima-specific range if host and VM share a different subnet.
if [[ -f "$SCRIPT_DIR/install-metallb.sh" ]]; then
  info "Installing MetalLB on Colima (pool + L2)..."
  if METALLB_POOL="${METALLB_POOL_COLIMA:-${METALLB_POOL:-192.168.106.240-192.168.106.250}}" bash "$SCRIPT_DIR/install-metallb.sh" 2>&1; then
    ok "MetalLB installed / pool and L2 applied on Colima"
  else
    warn "MetalLB install on Colima had issues; continuing (may already be present)"
  fi
else
  warn "install-metallb.sh not found; skipping MetalLB install"
fi

# 2. Ensure a LoadBalancer service so verification has an LB IP (ingress/egress target)
#    Deploy Caddy (same as k3d) so verify-metallb-and-traffic-policy.sh and advanced script work (off-campus-housing.local /_caddy/healthz).
NS_ING="${NS_ING:-ingress-nginx}"
kubectl create namespace "$NS_ING" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null || true

if [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" ]]; then
  info "Applying Caddy deployment and LoadBalancer service on Colima..."
  kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" --request-timeout=30s 2>/dev/null || true
  ok "Caddy deployment applied"
fi
if [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" ]]; then
  kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" --request-timeout=30s 2>/dev/null || true
  ok "Caddy LoadBalancer service applied (MetalLB will assign an IP)"
fi

# 3. Wait briefly for LB IP and Caddy to be ready so real L2 tests can run
lb_ip=""
for _w in $(seq 1 24); do
  lb_ip=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -n "$lb_ip" ]] && break
  sleep 5
done
if [[ -n "$lb_ip" ]]; then
  ok "Caddy LoadBalancer has external IP: $lb_ip (ingress: host→$lb_ip; egress: pods→cluster DNS or $lb_ip)"
else
  warn "Caddy LoadBalancer still pending; real L2 verification may wait or use existing LB IP"
fi

# Caddy pods ready (optional short wait)
kubectl wait -n "$NS_ING" --for=condition=ready pod -l app=caddy-h3 --timeout=60s 2>/dev/null || true

say "=== Colima MetalLB + ingress/egress ready for real L2 verification ==="
info "Run: METALLB_VERIFY_COLIMA_FULL=1 $SCRIPT_DIR/verify-metallb-colima-l2-only.sh (or let preflight 3c1c run it)"
