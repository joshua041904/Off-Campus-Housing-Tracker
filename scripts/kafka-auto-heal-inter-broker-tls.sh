#!/usr/bin/env bash
# Fix mixed inter-broker TLS trust (PKIX / truststore drift) after partial Kafka pod restarts:
# if verification fails or any broker is CrashLoopBackOff, delete all kafka-0..N-1 pods, wait Ready, re-verify.
#
# Usage:
#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-auto-heal-inter-broker-tls.sh
# Env:
#   KAFKA_INTER_BROKER_TLS_HEAL=0 — no-op (exit 0)
#   KAFKA_INTER_BROKER_TLS_HEAL_MAX_DELETE_ROUNDS — max delete+wait cycles after failed verify (default 1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

if [[ "${KAFKA_INTER_BROKER_TLS_HEAL:-1}" != "1" ]]; then
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || exit 0

if ! kubectl get sts kafka -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
  exit 0
fi

chmod +x "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" 2>/dev/null || true

_run_verify() {
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh"
}

_any_crashloop() {
  local i pod wr
  for ((i = 0; i < REP; i++)); do
    pod="kafka-${i}"
    wr="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
    if [[ "$wr" == "CrashLoopBackOff" ]]; then
      return 0
    fi
  done
  return 1
}

_delete_all_brokers_and_wait() {
  local i pod args=()
  echo "▶ kafka-auto-heal-inter-broker-tls: deleting broker pods kafka-0..$((REP - 1)) in ns=$NS (remount kafka-ssl-secret / uniform JKS)…"
  for ((i = 0; i < REP; i++)); do
    args+=("kafka-${i}")
  done
  kubectl delete pod -n "$NS" "${args[@]}" --request-timeout=90s
  local p
  for p in "${args[@]}"; do
    kubectl wait --for=condition=ready "pod/$p" -n "$NS" --timeout=300s --request-timeout=35s
  done
  sleep "${KAFKA_INTER_BROKER_TLS_HEAL_SETTLE_SEC:-5}"
}

_max_del="${KAFKA_INTER_BROKER_TLS_HEAL_MAX_DELETE_ROUNDS:-1}"
_round=0

if _any_crashloop; then
  echo "⚠️  kafka-auto-heal-inter-broker-tls: CrashLoopBackOff detected on at least one broker — recreating all brokers…"
  _delete_all_brokers_and_wait
  _round=$((_round + 1))
  if _run_verify; then
    echo "✅ kafka-auto-heal-inter-broker-tls: healthy after broker recreate"
    exit 0
  fi
  echo "❌ kafka-auto-heal-inter-broker-tls: verify still failed after CrashLoop recreate (check kafka-ssl-secret / CA chain)" >&2
  exit 1
fi

if _run_verify; then
  exit 0
fi

echo "⚠️  kafka-auto-heal-inter-broker-tls: cross-broker TLS verify failed (PKIX / JKS drift / partial restart?) — recreating all brokers…"

while [[ "$_round" -lt "$_max_del" ]]; do
  _delete_all_brokers_and_wait
  _round=$((_round + 1))
  if _run_verify; then
    echo "✅ kafka-auto-heal-inter-broker-tls: healthy after broker recreate (round $_round)"
    exit 0
  fi
  echo "⚠️  kafka-auto-heal-inter-broker-tls: verify failed after round $_round of $_max_del" >&2
done

echo "❌ kafka-auto-heal-inter-broker-tls: still failing after ${_max_del} recreate round(s). Try: ./scripts/kafka-runtime-sync.sh --remediate $NS $REP" >&2
exit 1
