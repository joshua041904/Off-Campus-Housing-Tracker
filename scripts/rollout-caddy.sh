#!/usr/bin/env bash
set -euo pipefail

# Project-aware: housing uses off-campus-housing-local-tls; override for other projects (e.g. PROJECT_NAME=record-platform).
PROJECT_NAME="${PROJECT_NAME:-off-campus-housing}"
NAMESPACE_INGRESS="${NAMESPACE_INGRESS:-ingress-nginx}"
# macOS sets HOSTNAME to the machine name — do not use it for Caddy/TLS docs.
CADDY_PUBLIC_HOSTNAME="${CADDY_PUBLIC_HOSTNAME:-off-campus-housing.test}"
TLS_SECRET="${TLS_SECRET:-${PROJECT_NAME}-local-tls}"

echo "🚀 Rolling out Caddy for project: $PROJECT_NAME"
echo "   Namespace (Caddy): $NAMESPACE_INGRESS"
echo "   Public hostname (SNI): $CADDY_PUBLIC_HOSTNAME"
echo "   TLS Secret: $TLS_SECRET"

NS="$NAMESPACE_INGRESS"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Ensure namespace exists (fresh cluster)
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# Colima + MetalLB: default to LoadBalancer deploy (no hostPort, soft anti-affinity so 2 replicas on 1 node)
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]] && kubectl get ns metallb-system --request-timeout=3s &>/dev/null; then
  CADDY_USE_LOADBALANCER="${CADDY_USE_LOADBALANCER:-1}"
fi

# When using hostPort or LoadBalancer, Caddy needs TLS secrets (dynamic per project)
if [ "${CADDY_USE_HOSTPORT:-0}" = "1" ] || [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ]; then
  if ! kubectl get secret "$TLS_SECRET" -n "$NS" &>/dev/null; then
    echo "❌ Missing secret $TLS_SECRET in namespace $NS."
    echo "Create it with:"
    echo ""
    echo "  kubectl create secret tls $TLS_SECRET \\"
    echo "    --cert=certs/off-campus-housing.test.crt \\"
    echo "    --key=certs/off-campus-housing.test.key \\"
    echo "    -n $NS"
    echo ""
    echo "  Or run: ./scripts/strict-tls-bootstrap.sh   # (requires certs in ./certs/)"
    exit 1
  fi
  if ! kubectl get secret dev-root-ca -n "$NS" &>/dev/null; then
    echo "❌ Missing secret dev-root-ca in namespace $NS. Create with ./scripts/strict-tls-bootstrap.sh"
    exit 1
  fi
fi

# Apply Caddy ConfigMap from repo root Caddyfile (api-gateway:4020, auth:4011 per README; gRPC h2c://envoy-test:10000)
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -

# Apply Caddy Deployment: substitute TLS secret name so deploy matches project (default off-campus-housing-local-tls in YAML)
_apply_deploy() {
  local file="$1"
  if [[ -f "$file" ]]; then
    sed "s/off-campus-housing-local-tls/$TLS_SECRET/g" "$file" | kubectl -n "$NS" apply -f -
    return 0
  fi
  return 1
}

if [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ]; then
  if _apply_deploy "infra/k8s/caddy-h3-deploy-loadbalancer.yaml"; then
    echo "✅ Applied Caddy deployment (LoadBalancer: 2 replicas, no hostPort)"
  else
    echo "⚠️  infra/k8s/caddy-h3-deploy-loadbalancer.yaml not found"; exit 1
  fi
elif _apply_deploy "infra/k8s/caddy-h3-deploy.yaml"; then
  true
elif [[ -f "./caddy-deploy.yaml" ]]; then
  kubectl -n "$NS" apply -f ./caddy-deploy.yaml
else
  echo "⚠️  No Caddy deploy file found"; exit 1
fi

# Service: LoadBalancer uses infra/k8s/loadbalancer.yaml (or caddy-h3-service-loadbalancer.yaml)
if [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ]; then
  if [ -f "infra/k8s/loadbalancer.yaml" ]; then
    kubectl -n "$NS" apply -f infra/k8s/loadbalancer.yaml
    echo "✅ Applied Caddy service (LoadBalancer, MetalLB) from infra/k8s/loadbalancer.yaml"
  elif [ -f "infra/k8s/caddy-h3-service-loadbalancer.yaml" ]; then
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service-loadbalancer.yaml
    echo "✅ Applied Caddy service (LoadBalancer, MetalLB) from caddy-h3-service-loadbalancer.yaml"
  else
    echo "⚠️  No loadbalancer.yaml or caddy-h3-service-loadbalancer.yaml found"; exit 1
  fi
elif [ "${CADDY_USE_HOSTPORT:-0}" = "1" ] && [ -f "infra/k8s/caddy-h3-service-clusterip.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service-clusterip.yaml
  echo "✅ Applied Caddy service (ClusterIP, hostPort 443)"
elif [ -f "infra/k8s/caddy-h3-svc.yaml" ]; then
  _np="${CADDY_NODEPORT:-30443}"
  if [[ "$_np" != "30443" ]]; then
    sed "s/nodePort: 30443/nodePort: $_np/g" infra/k8s/caddy-h3-svc.yaml | kubectl -n "$NS" apply -f -
  else
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
  fi
  echo "✅ Applied Caddy service (NodePort ${_np})"
elif [ -f "infra/k8s/caddy-h3-service-nodeport.yaml" ]; then
  _np="${CADDY_NODEPORT:-30443}"
  if [[ "$_np" != "30443" ]]; then
    sed "s/nodePort: 30443/nodePort: $_np/g" infra/k8s/caddy-h3-service-nodeport.yaml | kubectl -n "$NS" apply -f -
  else
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service-nodeport.yaml
  fi
  echo "✅ Applied Caddy service (NodePort ${_np})"
elif [ -f "infra/k8s/caddy-h3-service.yaml" ]; then
  _np="${CADDY_NODEPORT:-30443}"
  if [[ "$_np" != "30443" ]]; then
    sed "s/nodePort: 30443/nodePort: $_np/g" infra/k8s/caddy-h3-service.yaml | kubectl -n "$NS" apply -f -
  else
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml
  fi
  echo "✅ Applied Caddy service (NodePort ${_np})"
else
  echo "⚠️  No Caddy service file found!"
  echo "   For Colima+MetalLB: CADDY_USE_LOADBALANCER=1 (infra/k8s/loadbalancer.yaml)"
  echo "   For NodePort: infra/k8s/caddy-h3-svc.yaml or caddy-h3-service-nodeport.yaml"
  exit 1
fi

echo ""
echo "--- Pods (before rollout complete) ---"
kubectl -n "$NS" get pods -l app=caddy-h3 -o wide 2>/dev/null || true
echo ""
echo "--- Recent events ---"
kubectl -n "$NS" get events --sort-by='.lastTimestamp' 2>/dev/null | tail -12 || true
echo ""

if ! kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=120s 2>&1; then
  echo ""
  echo "--- Rollout didn't complete; pod status and events ---"
  kubectl -n "$NS" get pods -l app=caddy-h3 -o wide
  kubectl -n "$NS" get events --sort-by='.lastTimestamp' | tail -20
  for p in $(kubectl -n "$NS" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}'); do
    [[ -n "$p" ]] && kubectl -n "$NS" describe pod "$p" | sed -n '1,/^Events:/p' | tail -30
  done
  exit 1
fi

# Restart Envoy so listener 10000 stays plaintext (h2c); Caddy→Envoy no TLS. TLS/mTLS at edge (Caddy) and backend (Envoy→backends).
if kubectl get namespace envoy-test &>/dev/null && kubectl -n envoy-test get deployment envoy-test &>/dev/null; then
  kubectl -n envoy-test rollout restart deployment envoy-test 2>/dev/null && echo "✅ Restarted envoy-test (plaintext listener 10000)"
  kubectl -n envoy-test rollout status deployment envoy-test --timeout=60s 2>/dev/null || true
fi

# Surface Caddy logs (HTTP/3 listener, TLS, errors)
kubectl -n "$NS" logs deploy/caddy-h3 --tail=200 2>/dev/null | grep -E -i 'HTTP/3 listener|server running|protocols|http.log.error|x509|verify|dial|lookup' || true

# --- Preflight validation (never break again) ---
echo ""
echo "🔎 Preflight validation..."
kubectl get namespace "$NS" &>/dev/null || { echo "❌ Namespace $NS does not exist."; exit 1; }
kubectl get secret "$TLS_SECRET" -n "$NS" &>/dev/null || { echo "❌ TLS secret $TLS_SECRET missing in $NS."; exit 1; }
kubectl get secret dev-root-ca -n "$NS" &>/dev/null || { echo "❌ CA secret dev-root-ca missing in $NS."; exit 1; }
if kubectl get svc caddy-h3 -n "$NS" &>/dev/null; then
  echo "✅ Caddy service caddy-h3 present in $NS"
else
  echo "⚠️  Caddy service caddy-h3 not found in $NS (may still be creating)"
fi
echo "✅ Preflight checks passed."
