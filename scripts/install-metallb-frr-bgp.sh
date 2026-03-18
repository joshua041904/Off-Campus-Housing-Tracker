#!/usr/bin/env bash
# Deploy FRR and BGPPeer + BGPAdvertisement so MetalLB speaker peers with in-cluster FRR.
# Prereq: MetalLB installed (controller + speaker) and IPAddressPool + L2Advertisement applied.
# Usage: ./scripts/install-metallb-frr-bgp.sh
# See infra/k8s/metallb/README.md and docs/METALLB_ADVANCED.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

METALLB_NS="${METALLB_NS:-metallb-system}"
FRR_IMAGE="${FRR_IMAGE:-frr-metallb:local}"
SKIP_BUILD="${SKIP_BUILD:-0}"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# MetalLB must be present
if ! kubectl get ns "$METALLB_NS" &>/dev/null; then
  warn "Namespace $METALLB_NS not found. Install MetalLB first: ./scripts/install-metallb-colima.sh"
  exit 1
fi
if ! kubectl -n "$METALLB_NS" get deploy controller &>/dev/null; then
  warn "MetalLB controller not found. Install MetalLB first."
  exit 1
fi

# Build FRR image (same Docker as cluster for Colima; k3d will load it)
if [[ "$SKIP_BUILD" != "1" ]] && ! docker image inspect "$FRR_IMAGE" &>/dev/null 2>&1; then
  say "Building FRR image $FRR_IMAGE..."
  if ! docker build -t "$FRR_IMAGE" -f "$REPO_ROOT/infra/k8s/metallb/frr/Dockerfile" "$REPO_ROOT/infra/k8s/metallb/frr"; then
    warn "Docker build failed. Ensure Docker is running and alpine base is pullable."
    exit 1
  fi
  ok "FRR image built"
elif [[ "$SKIP_BUILD" == "1" ]]; then
  say "Skipping image build (SKIP_BUILD=1)"
else
  ok "FRR image $FRR_IMAGE already present"
fi

# k3d: load image into cluster
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"k3d"* ]] && command -v k3d &>/dev/null; then
  _cluster="${K3D_CLUSTER:-k3d-default}"
  if k3d cluster list 2>/dev/null | grep -q "$_cluster"; then
    say "Loading $FRR_IMAGE into k3d cluster $_cluster..."
    k3d image import "$FRR_IMAGE" -c "$_cluster" 2>/dev/null || true
    ok "Image loaded"
  fi
fi

# Apply FRR ConfigMap, Deployment, Service
say "Deploying FRR (ConfigMap + Deployment + Service)..."
kubectl apply -f "$REPO_ROOT/infra/k8s/metallb/frr-config.yaml" --validate=false
kubectl apply -f "$REPO_ROOT/infra/k8s/metallb/frr-deploy.yaml" --validate=false

# Wait for FRR pod and service
say "Waiting for FRR deployment..."
if ! kubectl -n "$METALLB_NS" rollout status deploy/frr --timeout=120s 2>/dev/null; then
  warn "FRR rollout timed out. Check: kubectl -n $METALLB_NS get pods -l app=frr"
  echo "  If ImagePullBackOff: ensure $FRR_IMAGE exists (docker images | grep frr-metallb). For k3d, run: k3d image import $FRR_IMAGE -c <cluster>"
  exit 1
fi
ok "FRR deployment ready"

# ClusterIP for BGPPeer peerAddress
frr_ip=$(kubectl -n "$METALLB_NS" get svc frr -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
if [[ -z "$frr_ip" ]]; then
  warn "FRR service has no ClusterIP. Check: kubectl -n $METALLB_NS get svc frr"
  exit 1
fi
ok "FRR service ClusterIP: $frr_ip"

# Apply BGPPeer (substitute peerAddress) and BGPAdvertisement
say "Applying BGPPeer (peerAddress=$frr_ip) and BGPAdvertisement..."
sed "s|FRR_SERVICE_IP|$frr_ip|g" "$REPO_ROOT/infra/k8s/metallb/bgppeer.yaml" | kubectl apply -f - --validate=false
kubectl apply -f "$REPO_ROOT/infra/k8s/metallb/bgpadvertisement.yaml" --validate=false
ok "BGPPeer and BGPAdvertisement applied"

say "FRR + BGP setup complete"
echo "  Verify BGP session: kubectl -n $METALLB_NS logs -l app=metallb,component=speaker --tail=50 | grep -i bgp"
echo "  Full verify (MetalLB IP, HTTP/3, BGP): ./scripts/verify-metallb-and-traffic-policy.sh"
echo "  Caddy LB IP: kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}'"
