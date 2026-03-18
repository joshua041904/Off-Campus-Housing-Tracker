#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Ensure namespace exists (fresh cluster after k3d-create-record-platform-443-lb.sh)
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# Colima + MetalLB: default to LoadBalancer deploy (no hostPort, soft anti-affinity so 2 pods on 1 node)
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]] && kubectl get ns metallb-system --request-timeout=3s &>/dev/null; then
  CADDY_USE_LOADBALANCER="${CADDY_USE_LOADBALANCER:-1}"
fi

# When using hostPort or LoadBalancer (Colima+MetalLB), Caddy needs TLS secrets
if [ "${CADDY_USE_HOSTPORT:-0}" = "1" ] || [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ]; then
  for sec in record-local-tls dev-root-ca; do
    if ! kubectl -n "$NS" get secret "$sec" &>/dev/null; then
      echo "❌ Missing secret $sec in namespace $NS. Create TLS secrets first, e.g.:"
      echo "   ./scripts/strict-tls-bootstrap.sh   # requires certs in ./certs/"
      echo "   or: scripts/rotate-ca-and-fix-tls.sh"
      exit 1
    fi
  done
fi

# Apply Caddy ConfigMap (gRPC must use h2c://envoy-test...:10000; do not use https:// for Envoy)
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -

# Apply Caddy Deployment (LoadBalancer path: no hostPort so 2 replicas can run on one node for zero-downtime).
# If you previously had the hostPort deploy applied, delete the deployment first so apply is clean:
#   kubectl -n ingress-nginx delete deployment caddy-h3
#   then re-run this script (or apply caddy-h3-deploy-loadbalancer.yaml).
# Deploy uses caddy-with-tcpdump:dev (HTTP/3 + tcpdump for rotation-suite capture). Build: docker build -t caddy-with-tcpdump:dev docker/caddy-with-tcpdump . k3d: k3d image import caddy-with-tcpdump:dev -c record-platform
if [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ] && [ -f "infra/k8s/caddy-h3-deploy-loadbalancer.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-deploy-loadbalancer.yaml
  echo "✅ Applied Caddy deployment (LoadBalancer: 2 replicas, no hostPort)"
elif [ -f "infra/k8s/caddy-h3-deploy.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-deploy.yaml
elif [ -f "./caddy-deploy.yaml" ]; then
  kubectl -n "$NS" apply -f ./caddy-deploy.yaml
fi

# Service: LoadBalancer (Colima+MetalLB); ClusterIP (k3d hostPort); else NodePort
if [ "${CADDY_USE_LOADBALANCER:-0}" = "1" ] && [ -f "infra/k8s/caddy-h3-service-loadbalancer.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service-loadbalancer.yaml
  echo "✅ Applied Caddy service (LoadBalancer, MetalLB) from caddy-h3-service-loadbalancer.yaml"
elif [ "${CADDY_USE_HOSTPORT:-0}" = "1" ] && [ -f "infra/k8s/caddy-h3-service-clusterip.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service-clusterip.yaml
  echo "✅ Applied Caddy service (ClusterIP, hostPort 443) from caddy-h3-service-clusterip.yaml"
elif [ -f "infra/k8s/caddy-h3-svc.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
  echo "✅ Applied Caddy service (NodePort 30443) from caddy-h3-svc.yaml"
elif [ -f "infra/k8s/caddy-h3-service.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml
  echo "✅ Applied Caddy service (NodePort 30443) from caddy-h3-service.yaml"
else
  echo "⚠️  WARNING: No Caddy service file found!"
  echo "   For 443@loadbalancer + hostPort: infra/k8s/caddy-h3-service-clusterip.yaml"
  echo "   For Colima+MetalLB: CADDY_USE_LOADBALANCER=1 (infra/k8s/caddy-h3-service-loadbalancer.yaml)"
  echo "   For MetalLB/NodePort: infra/k8s/caddy-h3-svc.yaml or caddy-h3-service.yaml"
fi

# Show what’s going on before waiting
echo ""
echo "--- Pods (before rollout complete) ---"
kubectl -n "$NS" get pods -l app=caddy-h3 -o wide 2>/dev/null || true
echo ""
echo "--- Recent events ---"
kubectl -n "$NS" get events --sort-by='.lastTimestamp' 2>/dev/null | tail -12 || true
echo ""

# Wait for rollout with timeout; on failure show why
if ! kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=120s 2>&1; then
  echo ""
  echo "--- Rollout didn’t complete; pod status and events ---"
  kubectl -n "$NS" get pods -l app=caddy-h3 -o wide
  kubectl -n "$NS" get events --sort-by='.lastTimestamp' | tail -20
  for p in $(kubectl -n "$NS" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}'); do
    if [ -n "$p" ]; then
      echo "--- $p ---"
      kubectl -n "$NS" describe pod "$p" | sed -n '1,/^Events:/p' | tail -30
    fi
  done
  exit 1
fi

# Restart Envoy so listener 10000 stays plaintext (h2c); Caddy→Envoy must not use TLS. See docs/RCA-GRPC-CADDY-ENVOY-TLS.md.
if kubectl get namespace envoy-test &>/dev/null && kubectl -n envoy-test get deployment envoy-test &>/dev/null; then
  kubectl -n envoy-test rollout restart deployment envoy-test 2>/dev/null && echo "✅ Restarted envoy-test (plaintext listener 10000)"
  kubectl -n envoy-test rollout status deployment envoy-test --timeout=60s 2>/dev/null || true
fi

kubectl -n "$NS" logs deploy/caddy-h3 --tail=200 2>/dev/null | egrep -i 'HTTP/3 listener|server running|protocols|http.log.error|x509|verify|dial|lookup' || true