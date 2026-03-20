#!/usr/bin/env bash
set -euo pipefail

CLUSTER=off-campus-housing-tracker
NAMESPACE=off-campus-housing-tracker

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
step() { echo; bold "▶ $*"; }

# 0) sanity: tools
for b in kind kubectl helm docker; do
  command -v "$b" >/dev/null || { echo "Missing $b. Install it first."; exit 1; }
done

# 1) kind cluster
if ! kind get clusters | grep -qx "$CLUSTER"; then
  step "Creating kind cluster: $CLUSTER"
  kind create cluster --name "$CLUSTER"
else
  step "Kind cluster '$CLUSTER' already exists"
fi

# 2) build app images
step "Building app images"
# Monorepo Node services: build from repo root with -f so workspace files are visible
docker build -t ghcr.io/yourorg/api-gateway:dev       -f services/api-gateway/Dockerfile       .
docker build -t ghcr.io/yourorg/auth-service:dev      -f services/auth-service/Dockerfile      .
docker build -t ghcr.io/yourorg/records-service:dev   -f services/records-service/Dockerfile   .
docker build -t ghcr.io/yourorg/listings-service:dev  -f services/listings-service/Dockerfile  .
docker build -t ghcr.io/yourorg/messaging-service:dev  -f services/messaging-service/Dockerfile  .
docker build -t ghcr.io/yourorg/shopping-service:dev   -f services/shopping-service/Dockerfile   .
docker build -t ghcr.io/yourorg/analytics-service:dev -f services/analytics-service/Dockerfile .
docker build -t ghcr.io/yourorg/auction-monitor:dev   -f services/auction-monitor/Dockerfile    .

# Python service: build with its own folder as the build context
# (its Dockerfile does COPY requirements.txt / app/, which live under that directory)
if [[ -f services/python-ai-service/Dockerfile ]]; then
  docker build -t ghcr.io/yourorg/python-ai-service:dev services/python-ai-service
else
  echo "WARN: services/python-ai-service/Dockerfile not found; skipping python-ai-service build"
fi

# 3) load into kind
step "Loading images into kind"
for i in \
  ghcr.io/yourorg/api-gateway:dev \
  ghcr.io/yourorg/auth-service:dev \
  ghcr.io/yourorg/records-service:dev \
  ghcr.io/yourorg/listings-service:dev \
  ghcr.io/yourorg/messaging-service:dev \
  ghcr.io/yourorg/shopping-service:dev \
  ghcr.io/yourorg/analytics-service:dev \
  ghcr.io/yourorg/auction-monitor:dev \
  ghcr.io/yourorg/python-ai-service:dev
do
  if docker image inspect "$i" >/dev/null 2>&1; then
    kind load docker-image "$i" --name "$CLUSTER"
  else
    echo "WARN: image $i not present locally; skipped loading"
  fi
done

# 4) namespace + apply overlay
step "Applying kustomize overlay to namespace: $NAMESPACE"
kubectl create ns "$NAMESPACE" 2>/dev/null || true
kubectl apply -k infra/k8s/overlays/dev

# 4b) rollout (don’t fail whole script if something needs debugging)
step "Waiting for Deployments to roll out (up to 90s each)…"
for d in api-gateway records-service auth-service listings-service messaging-service shopping-service analytics-service auction-monitor python-ai-service haproxy nginx nginx-exporter haproxy-exporter; do
  kubectl -n "$NAMESPACE" rollout status "deploy/$d" --timeout=90s || true
done

# 5) observability stack (Prometheus, Grafana, Jaeger, OTel, Linkerd)
step "Installing comprehensive observability stack..."
if [ -f "infra/k8s/scripts/install-observability.sh" ]; then
  bash infra/k8s/scripts/install-observability.sh
else
  # Fallback to basic Prometheus/Grafana if script not found
  step "Installing/Upgrading kube-prometheus-stack (Prometheus + Grafana)"
  kubectl create ns monitoring 2>/dev/null || true
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null
  helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --set grafana.adminPassword='Admin123!' \
    --set grafana.service.type=ClusterIP
  
  # Wait for ServiceMonitor CRD before applying SMs
  step "Waiting for ServiceMonitor CRD to be established…"
  for i in {1..60}; do
    if kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  
  # Apply ServiceMonitors
  step "Applying ServiceMonitors"
  kubectl -n monitoring apply -f infra/k8s/base/monitoring/servicemonitors.yaml || true
fi

# 7) show what’s up
step "Workload status in $NAMESPACE"
kubectl -n "$NAMESPACE" get deploy,svc,pod -o wide || true
step "Monitoring status"
kubectl -n monitoring get servicemonitors,prometheus,pod -o wide || true

echo
bold "Port-forward tips:"
echo "  Grafana:       kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80"
echo "  Prometheus:    kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090"
echo "  Jaeger:        kubectl -n observability port-forward svc/jaeger 16686:16686"
echo "  Linkerd Viz:   linkerd viz dashboard"
echo "  Services:      kubectl -n $NAMESPACE port-forward svc/nginx 8080:8080 8082:8082"
