#!/usr/bin/env bash
# Idempotent /etc/hosts line for OCH edge hostname → Caddy reachability IP.
#
# Default IP source: LoadBalancer EXTERNAL-IP (MetalLB) — correct for host → edge TLS/HTTP3.
# Optional: ALIGN_HOSTS_IP_SOURCE=clusterip uses .spec.clusterIP (only works if that IP is
# routable from this machine, e.g. some tunneled setups).
#
# Env:
#   ALIGN_HOSTS_DRY_RUN=1 — print before/after snapshot only; do not write /etc/hosts
#   SKIP_ALIGN_HOSTS=1 — no-op exit 0
#   OCH_EDGE_HOSTNAME — default off-campus-housing.test
#   OCH_CADDY_K8S_NS / OCH_CADDY_K8S_SVC — defaults depend on ALIGN_HOSTS_IP_SOURCE (see below)
#   ALIGN_HOSTS_WAIT_FOR_IP — default 1; set 0 to skip wait loop
#   ALIGN_HOSTS_WAIT_SEC / ALIGN_HOSTS_POLL_SEC — wait tuning
#   EXTERNAL_IP — force target IP (skip kubectl)
#   EDGE_HOSTS_STRICT / COLD_BOOTSTRAP_HOSTS_STRICT — passed through to ensure-edge-hosts
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/edge-test-url.sh
# shellcheck disable=SC1091
source "$REPO/scripts/lib/edge-test-url.sh"

if [[ "${SKIP_ALIGN_HOSTS:-0}" == "1" ]]; then
  echo "align-hosts: SKIP_ALIGN_HOSTS=1 — skipping"
  exit 0
fi

HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
MODE="${ALIGN_HOSTS_IP_SOURCE:-loadbalancer}"
_DRY="${ALIGN_HOSTS_DRY_RUN:-0}"
_WAIT="${ALIGN_HOSTS_WAIT_FOR_IP:-1}"
_MAX="${ALIGN_HOSTS_WAIT_SEC:-240}"
_POLL="${ALIGN_HOSTS_POLL_SEC:-3}"

if [[ "$MODE" == "clusterip" ]]; then
  export OCH_CADDY_K8S_NS="${OCH_CADDY_K8S_NS:-ingress}"
  export OCH_CADDY_K8S_SVC="${OCH_CADDY_K8S_SVC:-caddy}"
else
  export OCH_CADDY_K8S_NS="${OCH_CADDY_K8S_NS:-ingress-nginx}"
  export OCH_CADDY_K8S_SVC="${OCH_CADDY_K8S_SVC:-caddy-h3}"
fi

snapshot_hosts() {
  echo "--- /etc/hosts lines mentioning ${HOST} ---"
  if grep -F "$HOST" /etc/hosts 2>/dev/null; then
    :
  else
    echo "(none)"
  fi
}

discover_ip() {
  local ip=""
  if [[ -n "${EXTERNAL_IP:-}" ]]; then
    echo "${EXTERNAL_IP}" | tr -d '\r'
    return 0
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    return 1
  fi
  if [[ "$MODE" == "clusterip" ]]; then
    ip="$(kubectl get svc "${OCH_CADDY_K8S_SVC}" -n "${OCH_CADDY_K8S_NS}" -o jsonpath='{.spec.clusterIP}' 2>/dev/null | tr -d '\r' || true)"
  else
    ip="$(kubectl get svc "${OCH_CADDY_K8S_SVC}" -n "${OCH_CADDY_K8S_NS}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
  fi
  if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$ip"
    return 0
  fi
  edge_hint_lb_ip_for_och 2>/dev/null || true
}

wait_ip() {
  [[ "$_WAIT" != "1" ]] && return 0
  local ip="" n=0
  echo "align-hosts: waiting up to ${_MAX}s for ${OCH_CADDY_K8S_NS}/svc/${OCH_CADDY_K8S_SVC} ($MODE)…"
  while [[ $n -lt $_MAX ]]; do
    ip="$(discover_ip | head -1 || true)"
    if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "align-hosts: target IP: $ip"
      export EXTERNAL_IP="$ip"
      return 0
    fi
    sleep "$_POLL"
    n=$((n + _POLL))
  done
  echo "❌ align-hosts: no IP after ${_MAX}s (mode=$MODE ns=${OCH_CADDY_K8S_NS} svc=${OCH_CADDY_K8S_SVC})" >&2
  return 1
}

_strict="${EDGE_HOSTS_STRICT:-0}"
if [[ "${COLD_BOOTSTRAP:-0}" == "1" ]]; then
  _strict="${COLD_BOOTSTRAP_HOSTS_STRICT:-1}"
fi

echo "align-hosts: mode=$MODE host=$HOST (dry_run=$_DRY)"
echo "align-hosts: BEFORE"
snapshot_hosts

if [[ "$_DRY" == "1" ]]; then
  if ! wait_ip; then
    echo "align-hosts: dry-run — would fail strict wait (no IP yet)"
    exit 0
  fi
  echo "align-hosts: dry-run — would set ${EXTERNAL_IP:-?} $HOST (no write)"
  echo "align-hosts: AFTER (unchanged in dry-run)"
  snapshot_hosts
  exit 0
fi

wait_ip || exit 1

export HOSTS_AUTO="${HOSTS_AUTO:-1}"
export EDGE_HOSTS_STRICT="$_strict"
export OCH_EDGE_HOSTNAME="$HOST"
bash "$REPO/scripts/ensure-edge-hosts.sh"

echo "align-hosts: AFTER"
snapshot_hosts
