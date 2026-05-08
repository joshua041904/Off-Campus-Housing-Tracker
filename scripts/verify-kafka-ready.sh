#!/usr/bin/env bash
# Hard gate: all KRaft broker pods Ready + INTERNAL TLS port accepting TCP on kafka-0.
# Use after Kafka StatefulSet rollout / topic bootstrap and before app Deployments or verify-app-runtime.
# Logging: everything goes to stderr; keep stdout empty so callers (e.g. verify-app-runtime JSON) are not polluted.
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   KAFKA_BROKER_REPLICAS — default 3 (pods kafka-0 .. kafka-(R-1))
#   KAFKA_WAIT_POD_TIMEOUT — kubectl wait per pod (default 600s)
#   VERIFY_KAFKA_READY_SKIP — set to 1 to no-op (CI without brokers)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
R="${KAFKA_BROKER_REPLICAS:-3}"
POD_TO="${KAFKA_WAIT_POD_TIMEOUT:-600s}"
log() { echo "$*" >&2; }

if [[ "${VERIFY_KAFKA_READY_SKIP:-0}" == "1" ]]; then
  log "verify-kafka-ready: skipped (VERIFY_KAFKA_READY_SKIP=1)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "verify-kafka-ready: kubectl required" >&2; exit 1; }

log "verify-kafka-ready: ns=$NS replicas=$R"

for ((i = 0; i < R; i++)); do
  p="kafka-$i"
  if ! kubectl get pod "$p" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
    echo "verify-kafka-ready: pod/$p not found — is StatefulSet/kafka applied?" >&2
    exit 1
  fi
  log "verify-kafka-ready: kubectl wait pod/$p --for=condition=ready --timeout=$POD_TO"
  kubectl wait --for=condition=ready "pod/$p" -n "$NS" --timeout="$POD_TO" --request-timeout=30s 1>&2
done

if kubectl get sts kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  log "verify-kafka-ready: rollout status statefulset/kafka"
  kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_STS_ROLLOUT_TIMEOUT:-480s}" --request-timeout=30s 1>&2
fi

log "verify-kafka-ready: TCP check 127.0.0.1:9093 inside kafka-0"
kubectl exec -n "$NS" kafka-0 -- sh -c 'nc -z 127.0.0.1 9093' >/dev/null \
  || { echo "verify-kafka-ready: nc -z 127.0.0.1 9093 failed inside kafka-0" >&2; exit 1; }

log "✅ verify-kafka-ready: Kafka brokers ready and :9093 open"
