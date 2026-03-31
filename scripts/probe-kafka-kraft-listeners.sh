#!/usr/bin/env bash
# When Kafka pods are Running, verify controller port 9095 is listening and TLS answers locally.
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/probe-kafka-kraft-listeners.sh [kafka-0|kafka-1|kafka-2]
set -euo pipefail
NS="${HOUSING_NS:-off-campus-housing-tracker}"
POD="${1:-kafka-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
warn() { echo "⚠️  $*" >&2; }

command -v kubectl >/dev/null || { echo "kubectl required"; exit 1; }

say "Pod $POD in $NS"
if ! kubectl get pod "$POD" -n "$NS" --request-timeout=10s >/dev/null 2>&1; then
  echo "Pod $POD not found"
  exit 1
fi
_phase="$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
_ready="$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[?(@.name=="kafka")].ready}' 2>/dev/null || true)"
echo "  phase=$_phase kafka_container_ready=${_ready:-unknown}"

say "printenv | grep -E 'KAFKA_LISTENERS|KAFKA_LISTENER_SECURITY|KAFKA_INTER_BROKER|KAFKA_CONTROLLER_LISTENER|KAFKA_CONTROLLER_QUORUM|KAFKA_ADVERTISED'"
set +e
kubectl exec -n "$NS" "$POD" -c kafka -- sh -c 'printenv | grep -E "^KAFKA_LISTENERS=|^KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=|^KAFKA_INTER_BROKER_LISTENER_NAME=|^KAFKA_CONTROLLER_LISTENER_NAMES=|^KAFKA_CONTROLLER_QUORUM_VOTERS=|^KAFKA_ADVERTISED_LISTENERS="' 2>&1
_rc=$?
set -e
if [[ "$_rc" != 0 ]]; then
  warn "exec failed (pod CrashLoop / container not running). Fix StatefulSet and wait for Ready, then re-run."
  exit "$_rc"
fi

say "Listening sockets (9093 / 9094 / 9095)"
kubectl exec -n "$NS" "$POD" -c kafka -- sh -c '
  if command -v ss >/dev/null 2>&1; then ss -tlnp | grep -E ":9093|:9094|:9095" || true
  elif command -v netstat >/dev/null 2>&1; then netstat -tlnp 2>/dev/null | grep -E ":9093|:9094|:9095" || true
  else echo "no ss/netstat in image"; fi
' 2>&1

say "openssl s_client → localhost:9095 (brief TLS)"
kubectl exec -n "$NS" "$POD" -c kafka -- sh -c 'command -v openssl >/dev/null || { echo "no openssl"; exit 1; }; echo | openssl s_client -connect 127.0.0.1:9095 -brief 2>&1 | head -20' 2>&1

say "Done"
