#!/usr/bin/env bash
# Ensure in-cluster KRaft Kafka is reachable (kubectl), then topics + partition verify via
# wait-for-docker-compose-kafka-strict-ready.sh (k8s implementation).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"

say "=== Ensuring Kafka is Ready (Kubernetes KRaft) ==="

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found — cannot verify in-cluster Kafka"
  exit 1
fi

if ! kubectl get pod kafka-0 -n "$NS" &>/dev/null; then
  warn "kafka-0 not found in $NS — deploy infra/k8s/kafka-kraft-metallb (or apply your KRaft manifests)"
  exit 1
fi

if [[ "${PREFLIGHT_SKIP_DOCKER_COMPOSE_KAFKA_STRICT:-0}" == "1" ]]; then
  warn "PREFLIGHT_SKIP_DOCKER_COMPOSE_KAFKA_STRICT=1 — pod presence only; skipping topic gates"
  for _i in 0 1 2; do
    kubectl wait pod "kafka-${_i}" -n "$NS" --for=condition=Ready --timeout=120s 2>/dev/null || true
  done
  ok "Kafka pods waited (strict path skipped)"
  exit 0
fi

chmod +x "$SCRIPT_DIR/wait-for-docker-compose-kafka-strict-ready.sh" 2>/dev/null || true
REPO_ROOT="$REPO_ROOT" KAFKA_K8S_NS="$NS" bash "$SCRIPT_DIR/wait-for-docker-compose-kafka-strict-ready.sh"

ok "Kafka strict readiness complete (k8s topics + partitions)"
