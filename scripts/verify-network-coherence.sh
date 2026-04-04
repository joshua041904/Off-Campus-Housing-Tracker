#!/usr/bin/env bash
# Fail if Colima VM subnet, MetalLB pool, k3s node IP, and Kafka EXTERNAL advertised IPs disagree.
# Classic failure: bridged 192.168.64.x VM + pool on 192.168.5.x after Colima network mode change without cluster reset.
#
# Usage: ./scripts/verify-network-coherence.sh
# Env:
#   HOUSING_NS / KAFKA_BROKER_REPLICAS — Kafka checks (default off-campus-housing-tracker / 3)
#   VERIFY_NETWORK_COHERENCE_SKIP_KAFKA=1 — skip broker advertised.listeners vs LB check
#   VERIFY_NETWORK_COHERENCE_LENIENT=1 — warn only (exit 0); default is strict (exit 1 on mismatch)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/metallb-subnet-guard.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/metallb-subnet-guard.sh"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
LENIENT="${VERIFY_NETWORK_COHERENCE_LENIENT:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }
bad() { echo "❌ $*" >&2; }

fail() {
  if [[ "$LENIENT" == "1" ]]; then
    warn "$*"
  else
    bad "$*"
    exit 1
  fi
}

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

say "Network coherence (Colima / MetalLB / node / Kafka EXTERNAL)"

_ctx="$(kubectl config current-context 2>/dev/null || echo "")"
echo "  kubectl context: ${_ctx:-?}"

# --- Colima inspect (informational) ---
if command -v colima >/dev/null 2>&1; then
  say "Colima profile / network hints"
  if colima status 2>/dev/null | grep -q Running; then
    ok "Colima running"
    if colima inspect &>/dev/null; then
      echo "  (colima inspect — look for address / network mode vs host reachability)"
      colima inspect 2>/dev/null | grep -iE 'network|address|driver' | head -20 | sed 's/^/    /' || true
    fi
  else
    warn "Colima not running — VM eth0 checks skipped"
  fi
else
  warn "colima CLI not found — VM eth0 checks skipped"
fi

# --- eth0 vs node ---
say "VM eth0 vs k3s node InternalIP"
_vm="$(och_colima_eth0_ipv4 || true)"
_node="$(och_k8s_node_internal_ipv4 || true)"
[[ -n "$_vm" ]] && ok "Colima eth0 IPv4: $_vm" || warn "Could not read Colima eth0 (colima stopped or ssh failed)"
[[ -n "$_node" ]] && ok "Node InternalIP: $_node" || warn "Could not read node InternalIP"
if [[ -n "$_vm" && -n "$_node" ]]; then
  _vp="$(och_ipv4_prefix "$_vm" || true)"
  _np="$(och_ipv4_prefix "$_node" || true)"
  if [[ -n "$_vp" && -n "$_np" && "$_vp" != "$_np" ]]; then
    fail "Colima eth0 /24 ($_vp) != node InternalIP /24 ($_np) — split-brain networking"
  else
    ok "eth0 and node share /24 prefix (${_vp:-?})"
  fi
fi

# --- MetalLB pool ---
say "MetalLB IPAddressPool vs VM / node"
_pool_raw=""
if kubectl get crd ipaddresspools.metallb.io --request-timeout=8s &>/dev/null \
  && kubectl get ipaddresspools -n metallb-system --request-timeout=10s &>/dev/null; then
  _pool_raw="$(kubectl get ipaddresspools -n metallb-system -o jsonpath='{.items[0].spec.addresses[0]}' 2>/dev/null || true)"
fi
if [[ -z "$_pool_raw" ]]; then
  warn "No IPAddressPool found (MetalLB not installed or CRD missing) — pool check skipped"
else
  ok "IPAddressPool range: $_pool_raw"
  if ! och_assert_metallb_pool_coherent "$_pool_raw"; then
    exit 1
  fi
fi

# --- Kafka EXTERNAL vs LB ---
if [[ "${VERIFY_NETWORK_COHERENCE_SKIP_KAFKA:-0}" == "1" ]]; then
  say "Kafka advertised.listeners — skipped (VERIFY_NETWORK_COHERENCE_SKIP_KAFKA=1)"
else
  say "Kafka EXTERNAL advertised.listeners vs kafka-*-external LoadBalancer IP"
  _kfail=0
  for ((i = 0; i < REPLICAS; i++)); do
    if ! kubectl get pod "kafka-$i" -n "$NS" --request-timeout=15s &>/dev/null; then
      warn "Pod kafka-$i not in $NS — skip Kafka coherence for this broker"
      continue
    fi
    _lb="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    [[ "$_lb" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { warn "kafka-${i}-external has no IPv4 LB yet"; continue; }
    _line="$(kubectl exec -n "$NS" "kafka-$i" -c kafka --request-timeout=20s -- \
      grep -E '^advertised\.listeners=' /etc/kafka/kafka.properties 2>/dev/null | head -1 || true)"
    if [[ -z "$_line" ]]; then
      bad "kafka-$i: no advertised.listeners in kafka.properties"
      _kfail=1
      continue
    fi
    if [[ "$_line" != *"${_lb}:9094"* ]]; then
      bad "kafka-$i: EXTERNAL advert does not include LB ${_lb}:9094 (line: $_line). Run: make apply-kafka-kraft (or kafka-refresh-tls-from-lb + rollout restart statefulset/kafka)"
      _kfail=1
    else
      ok "kafka-$i: EXTERNAL matches ${_lb}:9094"
    fi
    _bpfx="$(echo "$_line" | sed -n 's/.*EXTERNAL:\/\/\([0-9.]*\):9094.*/\1/p' | head -1)"
    if [[ -n "$_bpfx" && "$_bpfx" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      _kp="$(och_ipv4_prefix "$_bpfx" || true)"
      if [[ -n "$_pool_raw" ]]; then
        _first="$(och_metallb_pool_first_ip "${_pool_raw// /}" || true)"
        _poolpfx="$(och_ipv4_prefix "$_first" || true)"
        if [[ -n "$_kp" && -n "$_poolpfx" && "$_kp" != "$_poolpfx" ]]; then
          bad "kafka-$i EXTERNAL /24 ($_kp) != MetalLB pool /24 ($_poolpfx) — subnet drift"
          _kfail=1
        fi
      fi
    fi
  done
  if [[ "$_kfail" -ne 0 ]]; then
    echo "" >&2
    echo "Heal hints:" >&2
    echo "  make apply-kafka-kraft" >&2
    echo "  # or: ./scripts/kafka-refresh-tls-from-lb.sh && kubectl rollout restart statefulset/kafka -n $NS" >&2
    if [[ "$LENIENT" == "1" ]]; then
      warn "Kafka coherence had failures (VERIFY_NETWORK_COHERENCE_LENIENT=1 — exit 0)"
    else
      exit 1
    fi
  fi
fi

say "Summary"
ok "Network coherence checks passed"
exit 0
