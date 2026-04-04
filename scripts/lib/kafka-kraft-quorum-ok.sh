#!/usr/bin/env bash
# Return 0 if kafka-metadata-quorum describe --status shows a leader (cluster can serve metadata).
# Usage: source this file and call och_kafka_kraft_quorum_ok [namespace]
# Env: KAFKA_CLUSTER_EXEC_TIMEOUT (default 45)
# Intentionally no set -euo: this file is sourced by other scripts.

och_kafka_kraft_quorum_ok() {
  local NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
  local EXEC_TO="${KAFKA_CLUSTER_EXEC_TIMEOUT:-45}"
  local _qout
  if ! kubectl get pod kafka-0 -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
    return 1
  fi
  _qout="$(
    kubectl exec -n "$NS" -i kafka-0 -c kafka --request-timeout="${EXEC_TO}s" -- bash -s 2>&1 <<'EOSCRIPT'
set -euo pipefail
TS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS")
PROP=/tmp/och-kafka-quorum-gate.props
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
  )" || return 1
  echo "$_qout" | grep -qi "leaderid"
}
