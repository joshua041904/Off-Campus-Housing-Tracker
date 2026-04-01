#!/usr/bin/env bash
# Pull current kafka-0/1/2-external LoadBalancer IPs, regenerate broker TLS (SANs), restart KRaft StatefulSet.
# Use after MetalLB pool / node changes when EXTERNAL IPs shift.
#
# If there is no drift (LB ↔ advertised + TLS SAN vs LB), skips TLS regen and rollout and only runs
# verify-kafka-cluster.sh. Force full remediation: KAFKA_SYNC_METALLB_FORCE=1 or ./scripts/kafka-sync-metallb.sh --force
#
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_SSL_* (see scripts/kafka-ssl-from-dev-root.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
FORCE="${KAFKA_SYNC_METALLB_FORCE:-0}"

for _arg in "$@"; do
  if [[ "$_arg" == "--force" ]]; then
    FORCE=1
    break
  fi
done

chmod +x "$SCRIPT_DIR/kafka-runtime-sync.sh" "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" "$SCRIPT_DIR/verify-kafka-cluster.sh" 2>/dev/null || true

if [[ "$FORCE" != "1" ]]; then
  if HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only --quiet "$NS" "$REP"; then
    echo "✅ kafka-sync-metallb: no runtime drift — skipping TLS regen and rollout (ns=$NS)."
    VERIFY_KAFKA_HEALTH_ONLY=0 \
      VERIFY_KAFKA_SKIP_META_IDENTITY=0 \
      VERIFY_KAFKA_SKIP_TLS_SANS=0 \
      VERIFY_KAFKA_SKIP_ADVERTISED=0 \
      VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=0 \
      VERIFY_KAFKA_SKIP_QUORUM_GATE=0 \
      VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=0 \
      VERIFY_KAFKA_SKIP_BROKER_API_GATE=0 \
      HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
      bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$REP"
    echo "✅ kafka-sync-metallb complete (verify only)."
    exit 0
  fi
  echo "⚠️  kafka-sync-metallb: drift or check failure — remediating (TLS refresh + rollout + verify)…"
else
  echo "=== kafka-sync-metallb --force (ns=$NS) ==="
fi

echo "=== kafka-sync-metallb (ns=$NS) ==="
bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"

echo "▶ Rolling Kafka StatefulSet (brokers pick up refreshed secrets + re-read LB file on new pods)…"
kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=30s
kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_ROLLOUT_TIMEOUT:-600s}"

VERIFY_KAFKA_HEALTH_ONLY=0 \
  VERIFY_KAFKA_SKIP_META_IDENTITY=0 \
  VERIFY_KAFKA_SKIP_TLS_SANS=0 \
  VERIFY_KAFKA_SKIP_ADVERTISED=0 \
  VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=0 \
  VERIFY_KAFKA_SKIP_QUORUM_GATE=0 \
  VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=0 \
  VERIFY_KAFKA_SKIP_BROKER_API_GATE=0 \
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
  bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$REP"

echo "✅ kafka-sync-metallb complete"
