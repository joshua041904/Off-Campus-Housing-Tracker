#!/usr/bin/env bash
# Idempotent /etc/hosts line for the edge hostname (default off-campus-housing.test) → MetalLB IP
# of caddy-h3 (or first ingress-nginx LoadBalancer). Used by make hosts-sanity / ensure-edge-hosts / dev-onboard.
#
# Env:
#   OCH_EDGE_HOSTNAME   — hostname (default off-campus-housing.test)
#   EXTERNAL_IP         — force LB IP (skips kubectl discovery)
#   HOSTS_AUTO          — 1 = append with sudo if missing (default 1 when unset; set 0 for hints only)
#   EDGE_HOSTS_STRICT   — 1 = exit 1 if IP missing after discovery, or sudo fails
# Stale /etc/hosts: when HOSTS_AUTO=1, existing lines for the hostname are removed then the correct line is written (idempotent).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/edge-test-url.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/edge-test-url.sh"

HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
STRICT="${EDGE_HOSTS_STRICT:-0}"
# Default auto-apply for greenfield onboarding; set HOSTS_AUTO=0 to only print hints.
HOSTS_AUTO="${HOSTS_AUTO:-1}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }
bad() { echo "❌ $*" >&2; }

discover_lb_ip() {
  local ip=""
  if command -v kubectl >/dev/null 2>&1; then
    ip="$(kubectl get svc caddy-h3 -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi
  ip="$(edge_hint_lb_ip_for_och 2>/dev/null || true)"
  if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$ip"
    return 0
  fi
  return 1
}

# First IPv4 on a line that contains the hostname as a whole field (best-effort).
hosts_file_ip_for_host() {
  local h="$1"
  while read -r line; do
    [[ "$line" =~ ^# ]] && continue
    local ip _rest
    read -r ip _rest <<<"$line"
    if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      for w in $line; do
        if [[ "$w" == "$h" ]]; then
          printf '%s\n' "$ip"
          return 0
        fi
      done
    fi
  done < /etc/hosts
}

host_resolves() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; socket.gethostbyname(\"$HOST\")" >/dev/null 2>&1 && return 0
  fi
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$HOST" >/dev/null 2>&1 && return 0
  fi
  return 1
}

resolved_ipv4() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; print(socket.gethostbyname(\"$HOST\"))" 2>/dev/null || return 1
    return 0
  fi
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$HOST" 2>/dev/null | awk '/STREAM/ {print $1; exit}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || return 1
    return 0
  fi
  # macOS: dscacheutil (same resolver family as many CLI tools)
  if [[ "$(uname -s)" == "Darwin" ]] && command -v dscacheutil >/dev/null 2>&1; then
    dscacheutil -q host -a name "$HOST" 2>/dev/null | awk '/ip_address:/{print $2; exit}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || return 1
    return 0
  fi
  return 1
}

# Remove every line containing the hostname, then append the canonical "IP hostname" line (idempotent).
write_hosts_mapping() {
  local ip="$1"
  local h="$2"
  local line="$ip $h"
  local cur=""
  if grep -qF "$h" /etc/hosts 2>/dev/null; then
    cur="$(hosts_file_ip_for_host "$h" || true)"
    if [[ -n "$cur" ]] && [[ "$cur" != "$ip" ]]; then
      warn "Replacing stale /etc/hosts for $h: $cur → $ip"
    fi
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    grep -vF "$h" /etc/hosts > /tmp/och.hosts.new 2>/dev/null || true
    printf '%s\n' "$line" >> /tmp/och.hosts.new
    mv /tmp/och.hosts.new /etc/hosts
    ok "Updated /etc/hosts: $line (root)"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo env OCH_HOSTS_NAME="$h" OCH_HOSTS_LINE="$line" bash -c '
      grep -vF "$OCH_HOSTS_NAME" /etc/hosts > /tmp/och.hosts.new 2>/dev/null || true
      printf "%s\n" "$OCH_HOSTS_LINE" >> /tmp/och.hosts.new
      mv /tmp/och.hosts.new /etc/hosts
    '
    ok "Updated /etc/hosts: $line (sudo)"
    return 0
  fi
  bad "Cannot write /etc/hosts (need root or sudo)."
  return 1
}

main() {
  local want_ip="${EXTERNAL_IP:-}"
  [[ -z "$want_ip" ]] && want_ip="$(discover_lb_ip || true)"
  want_ip="$(echo "$want_ip" | tr -d '\r' | head -1)"

  if [[ -n "$want_ip" ]] && ! [[ "$want_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    bad "Invalid IP from discovery: $want_ip"
    [[ "$STRICT" == "1" ]] && exit 1
    want_ip=""
  fi

  if [[ -z "$want_ip" ]]; then
    if host_resolves; then
      ok "$HOST already resolves (no LB IP from kubectl yet — OK if you set hosts manually)."
      return 0
    fi
    warn "No LoadBalancer IP for Caddy/ingress yet (normal before first deploy-dev)."
    echo "  After deploy: make ensure-edge-hosts   (or full: make dev-onboard)" >&2
    edge_print_resolve_and_hosts_hint "$HOST" ""
    [[ "$STRICT" == "1" ]] && exit 1
    return 0
  fi

  if [[ "$HOSTS_AUTO" != "1" ]]; then
    if grep -qE "[[:space:]]${HOST}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
      ok "hosts mapping present for $HOST (HOSTS_AUTO=0 — not modifying)."
    else
      warn "hosts mapping missing for $HOST. Add manually:" >&2
      echo "  sudo sh -c 'grep -qF \"$want_ip $HOST\" /etc/hosts || echo \"$want_ip $HOST\" >> /etc/hosts'" >&2
    fi
    return 0
  fi

  if ! write_hosts_mapping "$want_ip" "$HOST"; then
    [[ "$STRICT" == "1" ]] && exit 1
    return 0
  fi

  local rip=""
  if host_resolves; then
    rip="$(resolved_ipv4 2>/dev/null || true)"
  fi
  if [[ "$STRICT" == "1" ]]; then
    if [[ -z "$rip" ]]; then
      bad "STRICT: cannot resolve $HOST after /etc/hosts update (python3/getent/dscacheutil)."
      exit 1
    fi
    if [[ "$rip" != "$want_ip" ]]; then
      bad "STRICT: resolver maps $HOST → $rip but caddy-h3 LoadBalancer IP is $want_ip (fix DNS priority or /etc/hosts)."
      exit 1
    fi
    ok "$HOST resolves to $rip (matches LoadBalancer $want_ip)."
  else
    if [[ -n "$rip" ]] && [[ "$rip" != "$want_ip" ]]; then
      warn "Resolver maps $HOST → $rip but LoadBalancer is $want_ip (mDNS or DNS override?)."
    elif [[ -n "$rip" ]]; then
      ok "$HOST resolves for local tools (curl, k6, Playwright)."
    else
      bad "$HOST still does not resolve after updating /etc/hosts."
    fi
  fi
}

main "$@"
