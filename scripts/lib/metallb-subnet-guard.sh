#!/usr/bin/env bash
# Shared checks: MetalLB pool /24 must match k3s node InternalIP when API is up (authoritative for L2).
# Colima eth0 can differ (NAT/gateway vs bridged node IP) — we warn but do not fail if pool already matches the node.
# Source from bash:  source "$SCRIPT_DIR/lib/metallb-subnet-guard.sh"
#   och_metallb_pool_first_ip "$METALLB_POOL"  → first IP in range string
#   och_ipv4_prefix "a.b.c.d" → a.b.c
#   och_colima_eth0_ipv4
#   och_k8s_node_internal_ipv4
#   och_assert_metallb_pool_coherent "$METALLB_POOL"  → exit 0 or 1 (stderr on failure)

och_ipv4_prefix() {
  local ip="$1"
  case "$ip" in
    '' | *[!0-9.]* | *.*.*.*.*) return 1 ;;
  esac
  local o1 o2 o3 o4
  IFS=. read -r o1 o2 o3 o4 <<<"$ip"
  [[ -n "$o1" && -n "$o2" && -n "$o3" && -n "$o4" ]] || return 1
  printf '%s\n' "${o1}.${o2}.${o3}"
}

och_metallb_pool_first_ip() {
  local pool="$1"
  [[ -n "$pool" ]] || return 1
  local start="${pool%%-*}"
  start="${start// /}"
  [[ "$start" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  printf '%s\n' "$start"
}

och_colima_eth0_ipv4() {
  command -v colima >/dev/null 2>&1 || return 1
  colima status 2>/dev/null | grep -q Running || return 1
  colima ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1
}

och_k8s_node_internal_ipv4() {
  kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null \
    | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) { print $i; exit }}'
}

# Exit 0 if check skipped (no pool / no tools) or coherent; exit 1 on mismatch.
och_assert_metallb_pool_coherent() {
  local pool="${1:-}"
  local skip="${SKIP_METALLB_SUBNET_GUARD:-0}"
  [[ "$skip" == "1" ]] && return 0
  [[ -z "$pool" ]] && return 0

  local pool_ip pool_p
  pool_ip="$(och_metallb_pool_first_ip "$pool")" || {
    echo "❌ Invalid METALLB_POOL (expected start IP): $pool" >&2
    return 1
  }
  pool_p="$(och_ipv4_prefix "$pool_ip")" || return 1

  local vm_ip="" vm_p="" node_ip="" node_p=""
  vm_ip="$(och_colima_eth0_ipv4 || true)"
  if [[ -n "$vm_ip" ]]; then
    vm_p="$(och_ipv4_prefix "$vm_ip" || true)"
  fi

  # k3s node InternalIP is authoritative for where MetalLB L2 attaches.
  if command -v kubectl >/dev/null 2>&1 && kubectl get nodes --request-timeout=8s &>/dev/null; then
    node_ip="$(och_k8s_node_internal_ipv4 || true)"
    if [[ -n "$node_ip" ]]; then
      node_p="$(och_ipv4_prefix "$node_ip")" || true
      if [[ -n "$node_p" && "$node_p" != "$pool_p" ]]; then
        echo "❌ METALLB_POOL prefix ${pool_p}.x does not match k3s node InternalIP subnet ${node_p}.x (node=$node_ip, pool=$pool)." >&2
        return 1
      fi
      if [[ -n "$vm_p" && -n "$node_p" && "$vm_p" != "$node_p" ]]; then
        echo "⚠️  Colima eth0 (${vm_ip:-?}) /24 ${vm_p}.x differs from node InternalIP (${node_ip}) /24 ${node_p}.x — pool matches node (OK)." >&2
      fi
      return 0
    fi
  fi

  # No node IPv4 yet — best-effort: align pool with eth0 if we can see it.
  if [[ -n "$vm_ip" && -n "$vm_p" && "$vm_p" != "$pool_p" ]]; then
    echo "❌ MetalLB pool prefix ${pool_p}.x does not match Colima eth0 subnet ${vm_p}.x (eth0=$vm_ip, pool=$pool)." >&2
    echo "   Set METALLB_POOL to ${vm_p}.240-${vm_p}.250 or wait for kubectl and re-run." >&2
    return 1
  fi

  return 0
}
