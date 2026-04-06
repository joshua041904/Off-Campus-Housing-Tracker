#!/usr/bin/env bash
# After kubectl rollout restart statefulset/kafka: ensure each broker is Ready, not CrashLoopBackOff,
# and cross-broker truststore/keystore bytes + keytool listing match (same CA / PKIX trust anchor).
# Also scans recent logs for SSL handshake / PKIX failures.
#
# Usage:
#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-after-rollout-verify-brokers.sh
# Env:
#   KAFKA_TLS_GUARD_SKIP_LOG_SCAN=1 — skip log tail PKIX grep (faster)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

echo "▶ Post-rollout: broker Ready + no CrashLoopBackOff (ns=$NS replicas=$REP)…"
for ((i = 0; i < REP; i++)); do
  pod="kafka-${i}"
  wr="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
  if [[ "$wr" == "CrashLoopBackOff" ]]; then
    echo "❌ $pod is CrashLoopBackOff (mixed truststore after partial restart — try: kubectl delete pod -n $NS kafka-0 kafka-1 kafka-2)" >&2
    kubectl describe pod "$pod" -n "$NS" --request-timeout=30s | tail -40 || true
    exit 1
  fi
  rd="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$rd" != "True" ]]; then
    echo "❌ $pod not Ready after rollout (status waiting=$wr)" >&2
    exit 1
  fi
done
echo "✅ All kafka brokers Ready, not CrashLooping"

chmod +x "$SCRIPT_DIR/kafka-tls-guard.sh" 2>/dev/null || true
echo "▶ Cross-broker truststore/keystore parity + PKIX log tail (kafka-tls-guard POST_ROLLOUT_ONLY)…"
KAFKA_TLS_GUARD_POST_ROLLOUT_ONLY=1 KAFKA_TLS_GUARD_SKIP_VERIFY=1 \
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
  bash "$SCRIPT_DIR/kafka-tls-guard.sh"
