#!/usr/bin/env bash
# Legacy filename kept for callers. Docker Compose Kafka + ZooKeeper were removed; this waits for
# in-cluster KRaft brokers and ensures event topics (same contract as before: explicit topics + partitions).
#
# Env:
#   REPO_ROOT, ENV_PREFIX (default dev), OCH_KAFKA_TOPIC_SUFFIX (optional)
#   PREFLIGHT_SKIP_DOCKER_COMPOSE_KAFKA_STRICT=1 — exit 0
#   KAFKA_K8S_NS — default off-campus-housing-tracker
#   KAFKA_K8S_SKIP_API_HEALTH=1 — skip colima-api-health.sh
#   KAFKA_STRICT_NO_COMPOSE_UP — ignored (no compose); kept for caller compatibility
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

if [[ "${PREFLIGHT_SKIP_DOCKER_COMPOSE_KAFKA_STRICT:-0}" == "1" ]]; then
  echo "PREFLIGHT_SKIP_DOCKER_COMPOSE_KAFKA_STRICT=1 — skipping k8s Kafka strict path"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || die "kubectl required (in-cluster Kafka only)"
NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"

say "Kubernetes Kafka: wait kafka-0..2 Ready ($NS)"
for _i in 0 1 2; do
  kubectl get pod "kafka-${_i}" -n "$NS" --request-timeout=30s >/dev/null 2>&1 || die "Pod kafka-${_i} not found in $NS — deploy KRaft StatefulSet"
  kubectl wait pod "kafka-${_i}" -n "$NS" --for=condition=Ready --timeout=300s || die "kafka-${_i} not Ready"
done
ok "kafka-0, kafka-1, kafka-2 Ready"

chmod +x "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh" 2>/dev/null || true
REPO_ROOT="$REPO_ROOT" ENV_PREFIX="${ENV_PREFIX:-dev}" KAFKA_K8S_NS="$NS" bash "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh"

say "Verifying event topic partition counts…"
export KAFKA_PARTITION_VERIFY_TARGET=k8s
export KAFKA_K8S_NS="$NS"
STRICT_KAFKA_PARTITION_VERIFY=1 bash "$SCRIPT_DIR/verify-kafka-event-topic-partitions.sh"

ok "Kubernetes Kafka strict path complete (topics + partition verify)"
