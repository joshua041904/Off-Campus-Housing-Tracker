#!/usr/bin/env bash
# Build caddy-with-tcpdump:dev and load into Colima so caddy-h3 pods can pull it (fixes ImagePullBackOff).
# Strict TLS/mTLS: Caddy uses off-campus-housing-local-tls + dev-root-ca in ingress-nginx (from strict-tls-bootstrap).
#
# Usage: ./scripts/load-caddy-image-colima.sh
# From repo root. Requires: docker, colima running.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${CADDY_NS:-ingress-nginx}"

echo "Building caddy-with-tcpdump:dev (xcaddy + HTTP/3 + tcpdump)..."
docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile . || { echo "Build failed."; exit 1; }
echo "Loading image into Colima (so k3s can pull it)..."
docker save caddy-with-tcpdump:dev | colima ssh -- docker load || { echo "Load failed. Is Colima running?"; exit 1; }
echo "Restarting Caddy deploy so pods use the new image..."
kubectl -n "$NS" rollout restart deploy/caddy-h3 --request-timeout=15s || true
kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=120s || true
echo "Done. Verify: kubectl get pods -n $NS -l app=caddy-h3"
