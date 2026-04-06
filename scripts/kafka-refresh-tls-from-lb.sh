#!/usr/bin/env bash
# Regenerate kafka-ssl-secret (and och-kafka-ssl-secret) with SANs that include current
# kafka-*-external LoadBalancer IPs **and** any IPv4 SANs already on the deployed / on-disk
# broker cert (union). Replacing SANs with only today's LB IPs can drop a still-advertised
# MetalLB IP after churn and break inter-broker / controller TLS → CrashLoopBackOff.
#
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_SSL_* (see kafka-ssl-from-dev-root.sh)
#   KAFKA_SSL_MERGE_EXTRA_IP_SANS — optional comma-separated IPv4s to union in (e.g. stale MetalLB IP
#   missing from both secret and disk PEM after a bad refresh; use until brokers advertise new IPs).
#   KAFKA_SSL_AUTO_METALLB_IPS=0 after merge (LB + historical IPs already in EXTRA).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
export HOUSING_NS="$NS"
export KAFKA_BROKER_REPLICAS="$REP"

echo "=== kafka-refresh-tls-from-lb (ns=$NS replicas=$REP) ==="
command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required (extract IP SANs from broker PEM)"; exit 1; }

chmod +x "$SCRIPT_DIR/ensure-dev-root-ca.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/ensure-dev-root-ca.sh" "$REPO_ROOT"

bash "$SCRIPT_DIR/wait-for-kafka-external-lb-ips.sh"

_merge_tmp="$(mktemp)"
trap 'rm -f "$_merge_tmp"' EXIT

# Append IPv4 literals from an X.509 PEM (Subject Alternative Name section).
_append_ipv4_sans_from_pem() {
  local pem="$1"
  [[ -f "$pem" ]] || return 0
  openssl x509 -in "$pem" -noout -text 2>/dev/null \
    | grep -oE 'IP Address:[[:space:]]*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
    | sed 's/IP Address:[[:space:]]*//' >>"$_merge_tmp" || true
}

# 1) On-disk broker PEM from last local generation (if present)
LOCAL_PEM="$REPO_ROOT/certs/kafka-ssl/kafka-broker.pem"
_append_ipv4_sans_from_pem "$LOCAL_PEM"

# 2) Broker PEM currently in cluster (captures historical LB IPs still in use)
if kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=20s &>/dev/null; then
  _sec_pem="$(mktemp)"
  if kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.kafka-broker\.pem}' --request-timeout=20s 2>/dev/null \
    | base64 -d >"$_sec_pem" 2>/dev/null && [[ -s "$_sec_pem" ]]; then
    _append_ipv4_sans_from_pem "$_sec_pem"
  fi
  rm -f "$_sec_pem"
fi

# 3) Current per-broker external LoadBalancer IPv4s
for ((i = 0; i < REP; i++)); do
  _ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$_ip" ]] || [[ ! "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ kafka-${i}-external has no IPv4 LB IP (hostname-only LB not supported for this refresh path)"
    exit 1
  fi
  echo "$_ip" >>"$_merge_tmp"
done

if [[ -n "${KAFKA_SSL_MERGE_EXTRA_IP_SANS:-}" ]]; then
  _IFS="$IFS"
  IFS=,
  for _x in ${KAFKA_SSL_MERGE_EXTRA_IP_SANS}; do
    _x="${_x// /}"
    [[ -n "$_x" ]] && echo "$_x" >>"$_merge_tmp"
  done
  IFS="$_IFS"
fi

if [[ ! -s "$_merge_tmp" ]]; then
  echo "❌ No IPv4 addresses collected for KAFKA_SSL_EXTRA_IP_SANS"
  exit 1
fi

_extra_ips="$(sort -t. -k1,1n -k2,2n -k3,3n -k4,4n -u "$_merge_tmp" | paste -sd, -)"

echo "▶ Regenerating Kafka TLS (KAFKA_SSL_EXTRA_IP_SANS = union of existing cert IP SANs + live LB: ${_extra_ips})"
export KAFKA_SSL_NS="$NS"
export KAFKA_BROKER_REPLICAS="$REP"
export KAFKA_SSL_EXTRA_IP_SANS="${_extra_ips}"
export KAFKA_SSL_AUTO_METALLB_IPS="${KAFKA_SSL_AUTO_METALLB_IPS:-0}"

bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
echo "✅ kafka-refresh-tls-from-lb complete"
