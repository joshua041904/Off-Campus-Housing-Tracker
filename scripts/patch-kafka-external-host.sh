#!/usr/bin/env bash
# Patch kafka-external Endpoints so k8s pods can reach external Kafka (Docker on host).
# Required when Kafka runs in Docker Compose and services run in k8s (Colima).
# Usage: ./scripts/patch-kafka-external-host.sh
#   KAFKA_EXTERNAL_HOST_IP=...  — optional explicit host IP (most reliable)
#   KAFKA_SSL_PORT=29094        — host port (must match Docker Compose SSL listener)
#
# Resolution order:
#   1) KAFKA_EXTERNAL_HOST_IP
#   2) Docker (host-gateway) getent host.docker.internal — works on Docker Desktop / Engine 20.10+
#   3) colima ssh getent host.docker.internal
#   4) kubectl run busybox getent (in-cluster)
#   5) Fail with instructions (no silent wrong default — old 192.168.5.1 was often incorrect)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

resolve_host_ip() {
  local ip=""
  if [[ -n "${KAFKA_EXTERNAL_HOST_IP:-}" ]]; then
    echo "$KAFKA_EXTERNAL_HOST_IP"
    return 0
  fi

  # From host: map host.docker.internal to host loopback / bridge (Docker)
  if command -v docker >/dev/null 2>&1; then
    ip=$(
      docker run --rm --add-host=host.docker.internal:host-gateway alpine:3.19 \
        getent hosts host.docker.internal 2>/dev/null | awk '{print $1; exit}' | head -1 || true
    )
    [[ -n "$ip" ]] && echo "$ip" && return 0
  fi

  # Colima VM often resolves host.docker.internal where in-cluster busybox does not
  if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
    ip=$(colima ssh -- sh -c "getent hosts host.docker.internal 2>/dev/null | awk '{print \$1; exit}'" 2>/dev/null | head -1 || true)
    [[ -n "$ip" ]] && echo "$ip" && return 0
  fi

  # In-cluster DNS (may work on some clusters)
  local RAW
  RAW=$(kubectl run och-resolve-kafka-host --rm -i --restart=Never --image=busybox:1.36 -n off-campus-housing-tracker -- \
    getent hosts host.docker.internal 2>/dev/null || true)
  ip=$(echo "$RAW" | awk '{print $1; exit}' | head -1 || true)
  [[ -n "$ip" ]] && echo "$ip" && return 0

  echo ""
  return 1
}

HOST_IP=$(resolve_host_ip) || HOST_IP=""

if [[ -z "$HOST_IP" ]]; then
  echo "❌ Could not resolve host IP for Kafka (host.docker.internal)." >&2
  echo "   Set explicitly, e.g.:" >&2
  echo "     KAFKA_EXTERNAL_HOST_IP=192.168.5.2 $0" >&2
  echo "   (Use your Colima/Docker bridge IP; verify: docker run --rm --add-host=host.docker.internal:host-gateway alpine getent ahostsv4 host.docker.internal)" >&2
  exit 1
fi

KAFKA_SSL_PORT="${KAFKA_SSL_PORT:-29094}"
kubectl patch endpoints kafka-external -n off-campus-housing-tracker --type=merge \
  -p="{\"subsets\":[{\"addresses\":[{\"ip\":\"$HOST_IP\"}],\"ports\":[{\"port\":$KAFKA_SSL_PORT,\"name\":\"kafka-ssl\"}]}]}"

echo "✅ kafka-external Endpoints -> $HOST_IP:$KAFKA_SSL_PORT (external Kafka)"
