#!/usr/bin/env bash
# Kafka KRaft "final verification ritual" — mechanical cluster health (not Docker Compose).
# Run after: cert regen, MetalLB IP change, StatefulSet restart, or kafka-kraft-metallb infra edits.
#
# Phases (fail fast):
#   1) TLS SANs (INTERNAL FQDN + MetalLB IP SANs) — verify-kafka-tls-sans.sh
#   2) advertised.listeners per broker — verify-kafka-kraft-advertised-listeners.sh
#   3) KRaft quorum responds with a leader — kafka-metadata-quorum describe --status
#   4) No leadership renounce lines in kafka-0 logs in a recent window (default --since=10m; not full history — rollouts/TLS churn earlier is normal)
#   5) Broker API — kafka-broker-api-versions against headless kafka:9093 (SSL + mTLS via --command-config; INTERNAL is not PLAINTEXT)
#
# Optional: VERIFY_KAFKA_INCLUDE_GATEWAY_NC=1 — also nc -vz kafka 9093 from first api-gateway pod (stricter path check).
#
# Skips (for preflight when 6a2c/6a2c2 already ran):
#   VERIFY_KAFKA_HEALTH_ONLY=1 — skip phases 1–2; run 3–5 only
#   Or per-phase: VERIFY_KAFKA_SKIP_TLS_SANS=1, VERIFY_KAFKA_SKIP_ADVERTISED=1,
#   VERIFY_KAFKA_SKIP_QUORUM_GATE=1, VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=1, VERIFY_KAFKA_SKIP_BROKER_API_GATE=1
#
# What would break this cluster (operational checklist):
#   - MetalLB IP changes without cert regen → external TLS fails (mitigation: KAFKA_SSL_AUTO_METALLB_IPS=1).
#   - advertised.listeners drift (wrong INTERNAL/EXTERNAL) → metadata / peer confusion (6a2c2 + phase 2).
#   - Missing INTERNAL FQDN in broker SAN → inter-broker TLS fails (phase 1).
#   - Deleting StatefulSet PVCs → metadata log loss; full re-bootstrap required.
#   - Wrong KAFKA_CONTROLLER_QUORUM_VOTERS → no controller election.
#   - EndpointSlice / headless DNS corruption → transient resolution failures.
#
# Usage:
#   ./scripts/verify-kafka-cluster.sh [namespace] [replicas]
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_CHURN_LOG_SINCE (default 10m for renounce scan)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"
CHURN_SINCE="${KAFKA_CHURN_LOG_SINCE:-10m}"
EXEC_TO="${KAFKA_CLUSTER_EXEC_TIMEOUT:-45}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

if [[ "${VERIFY_KAFKA_HEALTH_ONLY:-0}" == "1" ]]; then
  VERIFY_KAFKA_SKIP_TLS_SANS="${VERIFY_KAFKA_SKIP_TLS_SANS:-1}"
  VERIFY_KAFKA_SKIP_ADVERTISED="${VERIFY_KAFKA_SKIP_ADVERTISED:-1}"
fi

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

say "Kafka cluster verification (ns=$NS replicas=$REPLICAS)"

if [[ "${VERIFY_KAFKA_SKIP_TLS_SANS:-0}" != "1" ]]; then
  say "Phase 6a2c — TLS SAN verification"
  chmod +x "$SCRIPT_DIR/verify-kafka-tls-sans.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REPLICAS"
  ok "TLS SAN verification passed"
else
  say "Phase 6a2c — skipped (VERIFY_KAFKA_SKIP_TLS_SANS=1 or VERIFY_KAFKA_HEALTH_ONLY=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_ADVERTISED:-0}" != "1" ]]; then
  say "Phase 6a2c2 — advertised.listeners verification"
  chmod +x "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" "$NS" "$REPLICAS"
  ok "advertised.listeners verification passed"
else
  say "Phase 6a2c2 — skipped (VERIFY_KAFKA_SKIP_ADVERTISED=1 or VERIFY_KAFKA_HEALTH_ONLY=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_QUORUM_GATE:-0}" == "1" ]] && [[ "${VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE:-0}" == "1" ]] && [[ "${VERIFY_KAFKA_SKIP_BROKER_API_GATE:-0}" == "1" ]]; then
  ok "Kafka cluster verification PASSED (TLS/advert gates only; kubectl health gates skipped)"
  exit 0
fi

if ! kubectl get pod kafka-0 -n "$NS" --request-timeout=25s >/dev/null 2>&1; then
  bad "Pod kafka-0 not found in $NS (cannot run quorum / API checks)"
  exit 1
fi

if [[ "${VERIFY_KAFKA_SKIP_QUORUM_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c3 — KRaft quorum stability (metadata quorum describe --status, SSL INTERNAL)"
  _qout="$(
    kubectl exec -n "$NS" -i kafka-0 -c kafka --request-timeout="${EXEC_TO}s" -- bash -s 2>&1 <<'EOSCRIPT'
set -euo pipefail
TS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS")
PROP=/tmp/och-kafka-ritual-quorum.props
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=$TS"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=$KS"
  echo "ssl.key.password=$KP"
  echo "ssl.endpoint.identification.algorithm="
} > "$PROP"
kafka-metadata-quorum --bootstrap-server kafka:9093 --command-config "$PROP" describe --status
rm -f "$PROP"
EOSCRIPT
  )" || {
    bad "kafka-metadata-quorum describe --status failed (broker not ready, quorum broken, or SSL client config?)"
    echo "$_qout" >&2
    exit 1
  }
  if ! echo "$_qout" | grep -qi "leaderid"; then
    bad "Quorum output missing LeaderId — unexpected describe --status format"
    echo "$_qout" >&2
    exit 1
  fi
  ok "Quorum reports LeaderId (metadata quorum reachable)"
else
  say "Phase 6a2c3 — skipped (VERIFY_KAFKA_SKIP_QUORUM_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c4 — leadership churn (kafka-0 logs since=$CHURN_SINCE: renounce / renouncing)"
  # Historical renounces during rolling restart, TLS, or advertised.listener changes are normal; only flag active churn.
  _churn="$(kubectl logs kafka-0 -n "$NS" -c kafka --request-timeout=60s --since="$CHURN_SINCE" 2>/dev/null | grep -i renoun || true)"
  if echo "$_churn" | grep -q .; then
    bad "Leadership churn indicators in kafka-0 logs since $CHURN_SINCE (grep -i renoun matched):"
    echo "$_churn" | tail -n 40 >&2
    exit 1
  fi
  ok "No renounce/renouncing matches in kafka-0 logs since $CHURN_SINCE"
else
  say "Phase 6a2c4 — skipped (VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_BROKER_API_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c5 — broker API responsiveness (kafka-broker-api-versions @ kafka:9093, SSL)"
  if ! kubectl exec -n "$NS" -i kafka-0 -c kafka --request-timeout="${EXEC_TO}s" -- bash -s >/dev/null 2>&1 <<'EOSCRIPT'
set -euo pipefail
TS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS")
PROP=/tmp/och-kafka-ritual-api.props
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=$TS"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=$KS"
  echo "ssl.key.password=$KP"
  echo "ssl.endpoint.identification.algorithm="
} > "$PROP"
kafka-broker-api-versions --bootstrap-server kafka:9093 --command-config "$PROP" >/dev/null
rm -f "$PROP"
EOSCRIPT
  then
    bad "kafka-broker-api-versions against kafka:9093 failed"
    exit 1
  fi
  ok "Broker API versions OK on headless kafka:9093 (SSL)"
else
  say "Phase 6a2c5 — skipped (VERIFY_KAFKA_SKIP_BROKER_API_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_INCLUDE_GATEWAY_NC:-0}" == "1" ]]; then
  say "Optional — nc kafka:9093 from api-gateway pod"
  _gw_pod="$(kubectl get pods -n "$NS" -l app=api-gateway --request-timeout=25s -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$_gw_pod" ]]; then
    bad "VERIFY_KAFKA_INCLUDE_GATEWAY_NC=1 but no api-gateway pod found in $NS"
    exit 1
  fi
  kubectl exec -n "$NS" "$_gw_pod" --request-timeout="${EXEC_TO}s" -- \
    sh -c 'command -v nc >/dev/null 2>&1 && nc -vz -w 5 kafka 9093' >/dev/null 2>&1 || {
    bad "nc -vz kafka 9093 from $_gw_pod failed (install nc in image or drop VERIFY_KAFKA_INCLUDE_GATEWAY_NC)"
    exit 1
  }
  ok "api-gateway → kafka:9093 reachable"
fi

say "Kafka cluster verification PASSED"
