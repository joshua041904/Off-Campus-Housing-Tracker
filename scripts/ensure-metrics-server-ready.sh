#!/usr/bin/env bash
# Best-effort: get metrics.k8s.io working so kubectl top nodes/pods works (HPA + k6 suite hooks).
# k3s/Colima: metrics-server often exists in kube-system but can be NotReady until restarted.
set -euo pipefail

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi

ns=kube-system
deploy=metrics-server

if ! kubectl get deployment "$deploy" -n "$ns" >/dev/null 2>&1; then
  echo "No Deployment/${deploy} in ${ns} — install metrics-server for your distro (k3s: often included)." >&2
  exit 1
fi

echo "Restarting ${ns}/${deploy} and waiting for rollout…"
kubectl rollout restart "deployment/${deploy}" -n "$ns"
kubectl rollout status "deployment/${deploy}" -n "$ns" --timeout=180s

if kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1; then
  echo "APIService v1beta1.metrics.k8s.io exists"
else
  echo "Warning: APIService v1beta1.metrics.k8s.io not found yet" >&2
fi

echo "Probing kubectl top nodes (may take ~30s after restart)…"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if kubectl top nodes --no-headers >/dev/null 2>&1; then
    echo "OK: kubectl top nodes works"
    kubectl top nodes
    exit 0
  fi
  echo "  attempt $i/10 — waiting 6s"
  sleep 6
done

echo "kubectl top still failing — check: kubectl logs -n $ns -l k8s-app=metrics-server --tail=50" >&2
exit 1
