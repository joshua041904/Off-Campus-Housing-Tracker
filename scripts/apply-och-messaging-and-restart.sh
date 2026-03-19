#!/usr/bin/env bash
# Final apply and restart (Phases 3–6 applied). Run from repo root.
# Prereq: OCH secrets exist (och-service-tls, och-kafka-ssl-secret).
# Apply uses each resource's namespace (do not force -n so envoy-test, observability, etc. apply).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
NS="${NAMESPACE:-off-campus-housing-tracker}"

echo "Applying overlays (resources use their own namespaces)..."
kubectl apply -k infra/k8s/overlays/dev

echo "Restarting messaging-service and auth-service..."
kubectl rollout restart deploy/messaging-service -n "$NS"
kubectl rollout restart deploy/auth-service -n "$NS"

echo "✅ Done. Check: kubectl get pods -n $NS"
