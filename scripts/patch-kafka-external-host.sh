#!/usr/bin/env bash
# Patch kafka-external Endpoints so k8s pods can reach external Kafka (Docker on host).
# Required when Kafka runs in Docker Compose and services run in k8s (Colima).
# Usage: ./scripts/patch-kafka-external-host.sh
#   KAFKA_EXTERNAL_HOST_IP=192.168.5.1  — optional; default: resolve host.docker.internal from cluster
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Use provided IP or resolve host.docker.internal from a one-off pod
if [[ -n "${KAFKA_EXTERNAL_HOST_IP:-}" ]]; then
  HOST_IP="$KAFKA_EXTERNAL_HOST_IP"
else
  # Resolve host.docker.internal from inside cluster (Colima/k3d); only accept IPv4
  RAW=$(kubectl run resolve-host-docker --rm -i --restart=Never --image=busybox:1.36 -n record-platform -- getent hosts host.docker.internal 2>/dev/null || true)
  HOST_IP=$(echo "$RAW" | grep -oE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' | head -1 || true)
  if [[ -z "$HOST_IP" ]]; then
    # Colima default bridge host IP (Mac from VM)
    HOST_IP="192.168.5.1"
    echo "⚠️  Could not resolve host.docker.internal; using default KAFKA_EXTERNAL_HOST_IP=$HOST_IP"
  fi
fi

kubectl patch endpoints kafka-external -n record-platform --type=merge \
  -p="{\"subsets\":[{\"addresses\":[{\"ip\":\"$HOST_IP\"}],\"ports\":[{\"port\":29093,\"name\":\"kafka-ssl\"}]}]}"

echo "✅ kafka-external Endpoints -> $HOST_IP:29093 (external Kafka)"
