#!/usr/bin/env bash
# Regenerate kafka-ssl-secret (and och-kafka-ssl-secret) with SANs that include current
# kafka-0/1/2-external LoadBalancer IPs. Requires Services to exist and have IPs first.
#
# Env: HOUSING_NS, KAFKA_SSL_* (see kafka-ssl-from-dev-root.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

echo "=== kafka-refresh-tls-from-lb (ns=$NS) ==="
command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }

bash "$SCRIPT_DIR/wait-for-kafka-external-lb-ips.sh"

echo "▶ Regenerating Kafka TLS (MetalLB / LB IPs merged via KAFKA_SSL_AUTO_METALLB_IPS)..."
export KAFKA_SSL_NS="$NS"
export KAFKA_SSL_AUTO_METALLB_IPS="${KAFKA_SSL_AUTO_METALLB_IPS:-1}"
# Fail if IPs still missing after wait (script above already enforced IPv4; double-check)
for i in 0 1 2; do
  _ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$_ip" ]]; then
    echo "❌ kafka-${i}-external has no IPv4 LB IP (hostname-only LB not supported for this refresh path)"
    exit 1
  fi
done

bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
echo "✅ kafka-refresh-tls-from-lb complete"
