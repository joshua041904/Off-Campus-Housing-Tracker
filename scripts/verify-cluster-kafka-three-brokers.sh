#!/usr/bin/env bash
# Fail if ConfigMap app-config KAFKA_BROKER does not list kafka-0..2 headless DNS seeds (three brokers).
# Usage: ./scripts/verify-cluster-kafka-three-brokers.sh
#   HOUSING_NS=off-campus-housing-tracker (default)
set -euo pipefail

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi

raw="$(kubectl -n "$HOUSING_NS" get configmap app-config -o jsonpath='{.data.KAFKA_BROKER}' 2>/dev/null || true)"
if [[ -z "${raw// /}" ]]; then
  echo "verify-kafka-three-brokers: missing ConfigMap app-config.data.KAFKA_BROKER in $HOUSING_NS" >&2
  exit 1
fi

if ! grep -q ':9093' <<<"$raw"; then
  echo "verify-kafka-three-brokers: expected SSL port :9093 in KAFKA_BROKER" >&2
  exit 1
fi

for i in 0 1 2; do
  if ! grep -q "kafka-${i}.kafka" <<<"$raw"; then
    echo "verify-kafka-three-brokers: KAFKA_BROKER missing seed for kafka-${i}.kafka… (snippet: ${raw:0:160})" >&2
    exit 1
  fi
done

echo "✅ KAFKA_BROKER lists kafka-0..2 headless seeds on :9093 (clients use all three via services/common kafka.ts)"
