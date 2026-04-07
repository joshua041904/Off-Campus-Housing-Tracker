#!/usr/bin/env bash
# Fail if the broker leaf PEM is missing required Subject Alternative Names for KRaft headless bootstrap.
# Prefers kafka-ssl-secret key kafka-broker.pem (written by kafka-ssl-from-dev-root.sh); else local file.
# DNS + MetalLB IP expectations are defined in scripts/lib/kafka-broker-sans.sh (keep in sync with generation).
#
# Usage:
#   ./scripts/verify-kafka-tls-sans.sh [namespace] [replicas]
#   KAFKA_TLS_PEM=/path/to/broker.pem ./scripts/verify-kafka-tls-sans.sh
# Env:
#   KAFKA_VERIFY_METALLB_IP_SANS=1 (default) — require broker PEM IP SANs for each kafka-N-external LoadBalancer IP (set 0 to skip).
#   STRICT_SAN_MODE=1 (default) — missing SAN → exit 1. STRICT_SAN_MODE=0 — warn only (e.g. dev without MetalLB).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"

# shellcheck source=lib/kafka-broker-sans.sh
source "$SCRIPT_DIR/lib/kafka-broker-sans.sh"

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

san_violation() {
  local msg="$1"
  if [[ "${STRICT_SAN_MODE:-1}" == "1" ]]; then
    bad "$msg"
    missing=1
  else
    warn "$msg (STRICT_SAN_MODE=0 — non-fatal)"
  fi
}

say "Kafka broker TLS SAN verification (namespace=$NS replicas=$REPLICAS STRICT_SAN_MODE=${STRICT_SAN_MODE:-1})"

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

while IFS='|' read -r kind name || [[ -n "$kind" ]]; do
  [[ -z "$kind" ]] && continue
  if [[ "$kind" == "simple" ]]; then
    if ! echo "$TEXT" | grep -q "DNS:${name}"; then
      san_violation "SAN missing: DNS:${name}"
    fi
  elif [[ "$kind" == "exact" ]]; then
    if [[ "$name" == "kafka" ]]; then
      if ! echo "$TEXT" | grep -qE 'DNS:kafka(,|$| )'; then
        san_violation "SAN missing: DNS:kafka (exact)"
      fi
    elif [[ "$name" == "localhost" ]]; then
      if ! echo "$TEXT" | grep -qE 'DNS:localhost(,|$| )'; then
        san_violation "SAN missing: DNS:localhost (exact)"
      fi
    fi
  fi
done < <(och_kafka_emit_san_verify_dns_specs "$NS" "$REPLICAS")

# MetalLB EXTERNAL listener uses raw IPv4; broker JKS must include each kafka-N-external LB IP as IP SAN.
if [[ "${KAFKA_VERIFY_METALLB_IP_SANS:-1}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  while IFS= read -r _lb_ip || [[ -n "$_lb_ip" ]]; do
    [[ -z "$_lb_ip" ]] && continue
    if [[ ! "$_lb_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      continue
    fi
    if ! echo "$TEXT" | grep -qE "IP Address:[[:space:]]*${_lb_ip}([^0-9]|$)"; then
      san_violation "SAN missing MetalLB IP for external listener: ${_lb_ip} (needed for EXTERNAL://${_lb_ip}:9094 mTLS)"
      echo "  Fix: KAFKA_SSL_EXTRA_IP_SANS=<comma-separated LB IPs> ./scripts/kafka-ssl-from-dev-root.sh"
      echo "  Then: kubectl rollout restart statefulset/kafka -n $NS"
    else
      ok "SAN includes IP ${_lb_ip} (kafka-*-external)"
    fi
  done < <(och_kafka_metallb_external_lb_ips_lines "$NS" "$REPLICAS")
fi

if [[ "$missing" -ne 0 ]]; then
  echo ""
  echo "OpenSSL SAN dump (first 40 lines):"
  echo "$TEXT" | grep -A200 "Subject Alternative Name" | head -40 || true
  exit 1
fi

ok "Broker PEM contains required DNS SANs for replicas 0..$((REPLICAS - 1))"
ok "Source: $PEM"
