#!/usr/bin/env bash
# Validate Jaeger Kubernetes Service: ports 16686 (UI/query) and 4318 (OTLP HTTP).
# Default manifest uses ClusterIP (infra/k8s/base/observability/jaeger-deploy.yaml).
# Set JAEGER_REQUIRE_LOADBALANCER=1 to require type=LoadBalancer and a non-empty external IP
# (e.g. after you patch the Service to MetalLB).
#
# Usage: JAEGER_REQUIRE_LOADBALANCER=1 ./scripts/validate-jaeger-lb.sh
# Env: JAEGER_K8S_NAMESPACE (default observability), JAEGER_K8S_SERVICE (default jaeger)
set -euo pipefail

NS="${JAEGER_K8S_NAMESPACE:-observability}"
SVC="${JAEGER_K8S_SERVICE:-jaeger}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "validate-jaeger-lb: kubectl not in PATH — skip"
  exit 0
fi

if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "validate-jaeger-lb: no reachable cluster context — skip"
  exit 0
fi

if ! kubectl get svc -n "$NS" "$SVC" >/dev/null 2>&1; then
  echo "validate-jaeger-lb: Service $NS/$SVC not found"
  exit 1
fi

ports="$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.spec.ports[*].port}' 2>/dev/null || true)"
if ! echo " $ports " | grep -qE ' 16686 '; then
  echo "validate-jaeger-lb: missing port 16686 (Jaeger UI / query) on $NS/$SVC"
  exit 1
fi
if ! echo " $ports " | grep -qE ' 4318 '; then
  echo "validate-jaeger-lb: missing port 4318 (OTLP HTTP) on $NS/$SVC"
  exit 1
fi

typ="$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.spec.type}')"
echo "validate-jaeger-lb: $NS/$SVC type=$typ ports include 16686, 4318"

if [[ "${JAEGER_REQUIRE_LOADBALANCER:-0}" == "1" ]] || [[ "$typ" == "LoadBalancer" ]]; then
  if [[ "$typ" != "LoadBalancer" ]]; then
    echo "validate-jaeger-lb: JAEGER_REQUIRE_LOADBALANCER=1 but Service type is $typ (expected LoadBalancer)"
    exit 1
  fi
  ip="$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  host="$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  if [[ -z "$ip" && -z "$host" ]]; then
    echo "validate-jaeger-lb: LoadBalancer has no external IP or hostname yet"
    exit 1
  fi
  echo "validate-jaeger-lb: external endpoint ip=${ip:-} hostname=${host:-}"
fi

exit 0
