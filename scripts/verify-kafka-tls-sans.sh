#!/usr/bin/env bash
# Fail if the broker leaf PEM is missing required Subject Alternative Names for KRaft headless bootstrap.
# Prefers kafka-ssl-secret key kafka-broker.pem (written by kafka-ssl-from-dev-root.sh); else local file.
#
# Usage:
#   ./scripts/verify-kafka-tls-sans.sh [namespace] [replicas]
#   KAFKA_TLS_PEM=/path/to/broker.pem ./scripts/verify-kafka-tls-sans.sh
# Env:
#   KAFKA_VERIFY_METALLB_IP_SANS=1 (default) — require broker PEM IP SANs to match kafka-N-external LoadBalancer IPs (set 0 to skip).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
bad() { echo "❌ $*"; }

PEM_TMP=""
cleanup() {
  if [[ -n "$PEM_TMP" && -f "$PEM_TMP" ]]; then
    rm -f "$PEM_TMP" || true
  fi
  return 0
}
trap cleanup EXIT

resolve_pem() {
  if [[ -n "${KAFKA_TLS_PEM:-}" && -f "$KAFKA_TLS_PEM" ]]; then
    echo "$KAFKA_TLS_PEM"
    return 0
  fi
  local local_pem="${REPO_ROOT}/certs/kafka-ssl/kafka-broker.pem"
  if [[ -f "$local_pem" ]]; then
    echo "$local_pem"
    return 0
  fi
  if command -v kubectl >/dev/null 2>&1 && kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=10s >/dev/null 2>&1; then
    PEM_TMP="$(mktemp)"
    if kubectl get secret kafka-ssl-secret -n "$NS" -o "jsonpath={.data.kafka-broker\.pem}" 2>/dev/null | base64 -d >"$PEM_TMP" 2>/dev/null; then
      if [[ -s "$PEM_TMP" ]]; then
        echo "$PEM_TMP"
        return 0
      fi
    fi
    rm -f "$PEM_TMP"
    PEM_TMP=""
  fi
  return 1
}

say "Kafka broker TLS SAN verification (namespace=$NS replicas=$REPLICAS)"

if ! PEM="$(resolve_pem)"; then
  bad "No broker PEM found."
  echo "  Fix: run scripts/kafka-ssl-from-dev-root.sh (adds kafka-broker.pem to kafka-ssl-secret),"
  echo "  or export KAFKA_TLS_PEM=/path/to/broker.pem"
  exit 1
fi

if ! openssl x509 -in "$PEM" -noout -text >/dev/null 2>&1; then
  bad "File is not a valid PEM certificate: $PEM"
  exit 1
fi

TEXT="$(openssl x509 -in "$PEM" -noout -text 2>/dev/null)"
missing=0
for ((i = 0; i < REPLICAS; i++)); do
  for name in \
    "kafka-${i}.kafka.${NS}.svc.cluster.local" \
    "kafka-${i}-external.${NS}.svc.cluster.local"; do
    if ! echo "$TEXT" | grep -q "DNS:${name}"; then
      bad "SAN missing: DNS:${name}"
      missing=1
    fi
  done
  for short in "kafka-${i}" "kafka-${i}.kafka" "kafka-${i}.kafka.${NS}.svc"; do
    if ! echo "$TEXT" | grep -q "DNS:${short}"; then
      bad "SAN missing: DNS:${short}"
      missing=1
    fi
  done
done

# Avoid false positives (e.g. DNS:kafka matching DNS:kafka-0).
if ! echo "$TEXT" | grep -qE 'DNS:kafka(,|$| )'; then
  bad "SAN missing: DNS:kafka (exact)"
  missing=1
fi
if ! echo "$TEXT" | grep -qE 'DNS:localhost(,|$| )'; then
  bad "SAN missing: DNS:localhost (exact)"
  missing=1
fi
if ! echo "$TEXT" | grep -q "DNS:kafka-external.${NS}.svc.cluster.local"; then
  bad "SAN missing: DNS:kafka-external.${NS}.svc.cluster.local"
  missing=1
fi

# MetalLB EXTERNAL listener uses raw IPv4; broker JKS must include each kafka-N-external LB IP as IP SAN.
if [[ "${KAFKA_VERIFY_METALLB_IP_SANS:-1}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  for ((i = 0; i < REPLICAS; i++)); do
    _lb_ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    [[ -n "$_lb_ip" ]] || continue
    if [[ ! "$_lb_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      continue
    fi
    if ! echo "$TEXT" | grep -qE "IP Address:[[:space:]]*${_lb_ip}([^0-9]|$)"; then
      bad "SAN missing MetalLB IP for kafka-${i}-external: ${_lb_ip} (needed for EXTERNAL://${_lb_ip}:9094 mTLS)"
      echo "  Fix: KAFKA_SSL_EXTRA_IP_SANS=<comma-separated LB IPs> ./scripts/kafka-ssl-from-dev-root.sh"
      echo "  Then: kubectl rollout restart statefulset/kafka -n $NS"
      missing=1
    else
      ok "SAN includes IP ${_lb_ip} (kafka-${i}-external)"
    fi
  done
fi

if [[ "$missing" -ne 0 ]]; then
  echo ""
  echo "OpenSSL SAN dump (first 40 lines):"
  echo "$TEXT" | grep -A200 "Subject Alternative Name" | head -40 || true
  exit 1
fi

ok "Broker PEM contains required DNS SANs for replicas 0..$((REPLICAS - 1))"
ok "Source: $PEM"
