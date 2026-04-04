#!/usr/bin/env bash
# Print Prometheus text exposition for kafka-ssl-secret CA fingerprint (host / CronJob).
# Does not start an HTTP server — pipe to Pushgateway or redirect to a file if needed.
#
# Usage: ./scripts/export-kafka-ca-metric.sh
# Env: HOUSING_NS (default off-campus-housing-tracker)
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl required" >&2; exit 1; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$TMP"
FP="$(openssl x509 -in "$TMP" -noout -fingerprint -sha256 | cut -d= -f2)"

cat <<EOF
# HELP kafka_ca_info Current Kafka CA fingerprint (kafka-ssl-secret ca-cert.pem)
# TYPE kafka_ca_info gauge
kafka_ca_info{fingerprint="${FP}",namespace="${NS}"} 1
EOF
