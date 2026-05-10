#!/usr/bin/env bash
# CI / local: table tests for scripts/lib/kafka-metallb-pin-formula.sh (legacy pool math).
# Optional live: if kubectl + kafka-0-external exist, assert each kafka-N-external has a real LB IP
# (status.loadBalancer.ingress) and warn if spec.loadBalancerIP is still set (deprecated pinning).
#
# Usage: ./scripts/verify-kafka-metallb-pin-formula.sh
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS (live). METALLB_POOL / KAFKA_METALLB_FIRST_OFFSET — table tests only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/kafka-metallb-pin-formula.sh"

FAIL=0

_assert_row() {
  local pool="$1" off="$2" rep="$3"
  shift 3
  local i got want
  for ((i = 0; i < rep; i++)); do
    want="$1"
    shift
    got="$(och_kafka_metallb_expected_ip_for_broker "$pool" "$off" "$i")" || {
      echo "❌ formula error pool=$pool off=$off i=$i" >&2
      FAIL=1
      return
    }
    if [[ "$got" != "$want" ]]; then
      echo "❌ expected_ip broker $i: want $want got $got (pool=$pool offset=$off)" >&2
      FAIL=1
    fi
  done
}

echo "=== verify-kafka-metallb-pin-formula (table tests) ==="
# Colima doc default + k3d-style pool
_assert_row "192.168.64.240-192.168.64.250" 1 3 192.168.64.241 192.168.64.242 192.168.64.243
_assert_row "172.18.0.240-172.18.0.250" 1 3 172.18.0.241 172.18.0.242 172.18.0.243
# offset 0: broker-0 equals pool first IP
_assert_row "10.0.0.100-10.0.0.110" 0 2 10.0.0.100 10.0.0.101

if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ verify-kafka-metallb-pin-formula: table tests failed" >&2
  exit 1
fi
echo "✅ Table tests passed"

# Optional live check (self-hosted runner / dev with cluster): allocator-assigned ingress IPs
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

if command -v kubectl >/dev/null 2>&1 && kubectl get svc kafka-0-external -n "$NS" --request-timeout=10s >/dev/null 2>&1; then
  echo "=== verify-kafka-metallb-pin-formula (live LB ingress IPs, ns=$NS) ==="
  _och_lb_ips=()
  for ((i = 0; i < REP; i++)); do
    ing="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' --request-timeout=15s 2>/dev/null | tr -d '\r' || true)"
    req="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.spec.loadBalancerIP}' --request-timeout=15s 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$req" ]]; then
      echo "⚠️  kafka-${i}-external: spec.loadBalancerIP=$req (deprecated; strip with STRIP_KAFKA_EXTERNAL_REQUESTED_LB_IP=1 scripts/patch-kafka-external-metallb-pinned-ips.sh)" >&2
    fi
    if [[ -z "$ing" ]] || ! [[ "$ing" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "❌ kafka-${i}-external: no status.loadBalancer.ingress[0].ip (allocator not done or Service broken)" >&2
      FAIL=1
      _och_lb_ips[$i]=""
      continue
    fi
    _och_lb_ips[$i]="$ing"
    echo "✅ kafka-${i}-external ingress ip → $ing"
  done
  for ((i = 0; i < REP; i++)); do
    [[ -n "${_och_lb_ips[$i]:-}" ]] || continue
    for ((j = i + 1; j < REP; j++)); do
      if [[ -n "${_och_lb_ips[$j]:-}" ]] && [[ "${_och_lb_ips[$i]}" == "${_och_lb_ips[$j]}" ]]; then
        echo "❌ duplicate LB IP ${_och_lb_ips[$i]} (kafka-${i}-external and kafka-${j}-external)" >&2
        FAIL=1
      fi
    done
  done
  [[ "$FAIL" -eq 0 ]] || exit 1
else
  echo "ℹ️  Skipping live check (no kubectl or no kafka-0-external in $NS)"
fi

echo "✅ verify-kafka-metallb-pin-formula complete"
