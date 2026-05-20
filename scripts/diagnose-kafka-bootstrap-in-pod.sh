#!/usr/bin/env bash
# Quick answers: does 9092 work? does 9093 + SSL work? (KRaft metallb: 9092 is not used — expect A to fail fast with --request-timeout.)
# Usage: ./scripts/diagnose-kafka-bootstrap-in-pod.sh
# Env: KAFKA_K8S_NS KAFKA_K8S_POD KUBECTL_REQUEST_TIMEOUT
set -euo pipefail
NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"
KPOD="${KAFKA_K8S_POD:-kafka-0}"
KREQ=(--request-timeout="${KUBECTL_REQUEST_TIMEOUT:-45s}")

echo "=== Pods (app=kafka) in $NS ==="
kubectl "${KREQ[@]}" get pods -n "$NS" -l app=kafka -o wide || true

echo ""
echo "=== A: Plaintext 127.0.0.1:9092 --list (KRaft: no listener; bounded with timeout 12s inside pod) ==="
set +e
out="$(kubectl "${KREQ[@]}" exec -n "$NS" "$KPOD" -- timeout 12 kafka-topics --bootstrap-server 127.0.0.1:9092 --list 2>&1)"
code=$?
set -e
printf '%s\n' "$out" | head -8
echo "(exit $code) — expect failure on KRaft; use :9093 + SSL below."

echo ""
echo "=== B: SSL 127.0.0.1:9093 (same JKS contract as create-kafka-event-topics-k8s.sh) ==="
kubectl "${KREQ[@]}" exec -n "$NS" "$KPOD" -- bash -ec '
set -euo pipefail
TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.endpoint.identification.algorithm="
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-diagnose.props
kafka-topics --bootstrap-server 127.0.0.1:9093 --command-config /tmp/och-diagnose.props --list
' | head -20
echo "… (trimmed) — if you see topic names, loopback SSL bootstrap is OK."

echo ""
echo "=== C: SSL kafka-0.kafka.$NS.svc.cluster.local:9093 (cluster DNS, matches INTERNAL advertised name) ==="
kubectl "${KREQ[@]}" exec -n "$NS" "$KPOD" -- env "POD_NS=$NS" bash -ec '
set -euo pipefail
TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.endpoint.identification.algorithm="
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-diagnose-dns.props
kafka-topics --bootstrap-server "kafka-0.kafka.${POD_NS}.svc.cluster.local:9093" --command-config /tmp/och-diagnose-dns.props --list
' | head -20
echo "… (trimmed) — if both B and C list topics, set KAFKA_BOOTSTRAP_SERVER to either for admin tools."

echo ""
echo "✅ Diagnose complete. Topic scripts default: kafka-0.kafka.<ns>.svc.cluster.local:9093 + /tmp/*.props (not plaintext :9092)."
