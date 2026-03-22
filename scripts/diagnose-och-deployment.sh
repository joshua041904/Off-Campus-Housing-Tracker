#!/usr/bin/env bash
# Quick readiness diagnostics for a Deployment in off-campus-housing-tracker.
# Usage: ./scripts/diagnose-och-deployment.sh media-service
#        ./scripts/diagnose-och-deployment.sh auth-service
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
DEPLOY="${1:?usage: $0 <deployment-name>}"

echo "=== kubectl describe pod (first pod for $DEPLOY) ==="
POD=$(kubectl get pods -n "$NS" -l "app=$DEPLOY" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  echo "No pod found for app=$DEPLOY in $NS"
  exit 1
fi
kubectl describe pod -n "$NS" "$POD" | sed -n '/Conditions:/,/Volumes:/p' | head -40

echo ""
echo "=== Recent events (probe / mount / OOM) ==="
kubectl get events -n "$NS" --field-selector "involvedObject.name=$POD" --sort-by='.lastTimestamp' 2>/dev/null | tail -15 || true

echo ""
echo "=== Container logs (last 80 lines) ==="
kubectl logs -n "$NS" "$POD" --tail=80 2>&1 || echo "(no logs yet)"

echo ""
echo "=== Hints ==="
case "$DEPLOY" in
  media-service)
    echo "  media-service readiness = gRPC Health Check on media.MediaService → DB SELECT 1."
    echo "  Requires POSTGRES_URL_MEDIA (app-config) reachable from the pod, usually host:5448."
    echo "  If logs show 'listening on 50068' but probes fail: probes use 127.0.0.1 (not localhost) to avoid IPv6 ::1 vs IPv4 bind."
    echo "  On Colima/k3s: ensure postgres-media is up (docker compose) and host.docker.internal resolves from pods;"
    echo "  if not, set DATABASE_HOST in an overlay (e.g. host.lima.internal) — see app-config comments."
    ;;
  *)
    echo "  See deploy.yaml for this service: startup/readiness probes and env (DB URLs, TLS paths)."
    ;;
esac
