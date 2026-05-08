#!/usr/bin/env bash
# Cold-bootstrap / lab: wait for Caddy (ingress) LoadBalancer IP, then idempotently sync
# /etc/hosts for the edge hostname (default off-campus-housing.test).
#
# Delegates to scripts/ensure-edge-hosts.sh (same kubectl discovery + sudo-safe rewrite).
#
# Env:
#   SKIP_COLD_BOOTSTRAP_HOSTS_SYNC=1 — no-op exit 0
#   SYNC_HOSTS_WAIT_FOR_LB — default 1; set 0 to skip wait loop (use if EXTERNAL_IP already set)
#   SYNC_HOSTS_WAIT_SEC — default 240
#   SYNC_HOSTS_POLL_SEC — default 3
#   OCH_CADDY_K8S_NS / OCH_CADDY_K8S_SVC — passed through to ensure-edge-hosts (defaults ingress-nginx / caddy-h3)
#   COLD_BOOTSTRAP_HOSTS_STRICT — default 1 when COLD_BOOTSTRAP=1: EDGE_HOSTS_STRICT=1 (exit 1 if IP never appears)
#   HOSTS_AUTO, OCH_EDGE_HOSTNAME, EXTERNAL_IP — see scripts/ensure-edge-hosts.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${SKIP_COLD_BOOTSTRAP_HOSTS_SYNC:-0}" == "1" ]]; then
  echo "sync-hosts: SKIP_COLD_BOOTSTRAP_HOSTS_SYNC=1 — skipping"
  exit 0
fi

_NS="${OCH_CADDY_K8S_NS:-ingress-nginx}"
_SVC="${OCH_CADDY_K8S_SVC:-caddy-h3}"
_WAIT="${SYNC_HOSTS_WAIT_FOR_LB:-1}"
_MAX="${SYNC_HOSTS_WAIT_SEC:-240}"
_POLL="${SYNC_HOSTS_POLL_SEC:-3}"

wait_for_lb() {
  [[ "$_WAIT" != "1" ]] && return 0
  local ip="" n=0
  echo "sync-hosts: waiting up to ${_MAX}s for ${_NS}/svc/${_SVC} LoadBalancer IP…"
  while [[ $n -lt $_MAX ]]; do
    if command -v kubectl >/dev/null 2>&1; then
      ip="$(kubectl get svc "$_SVC" -n "$_NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    fi
    if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "sync-hosts: LoadBalancer IP: $ip"
      return 0
    fi
    sleep "$_POLL"
    n=$((n + _POLL))
  done
  echo "❌ sync-hosts: timed out after ${_MAX}s — no EXTERNAL-IP on ${_NS}/svc/${_SVC}" >&2
  return 1
}

_strict="${EDGE_HOSTS_STRICT:-0}"
if [[ "${COLD_BOOTSTRAP:-0}" == "1" ]]; then
  _strict="${COLD_BOOTSTRAP_HOSTS_STRICT:-1}"
fi

wait_for_lb || exit 1

export OCH_CADDY_K8S_NS="$_NS"
export OCH_CADDY_K8S_SVC="$_SVC"
export HOSTS_AUTO="${HOSTS_AUTO:-1}"
export EDGE_HOSTS_STRICT="$_strict"
export OCH_EDGE_HOSTNAME="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"

exec bash "$REPO/scripts/ensure-edge-hosts.sh"
