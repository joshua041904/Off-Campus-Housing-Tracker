#!/usr/bin/env bash
# Ensure Kubernetes API is reachable at 127.0.0.1:6443 on the host.
# Colima often exposes k3s on a different port (e.g. 51819) in the VM; this script
# starts an SSH tunnel so host 6443 -> guest <k3s-port>, then sets kubeconfig to 6443.
#
# Use: ./scripts/colima-forward-6443.sh [--restart]
#   --restart  kill any existing tunnel and start fresh (use when you see TLS handshake timeout / flaky kubectl)
#
# Verification uses curl against https://127.0.0.1:6443/version — NOT nc alone (TCP open ≠ working TLS/API).
# Before heavy kubectl (apply / wait loops): ./scripts/colima-api-health.sh
#
# Env:
#   COLIMA_6443_API_PROBE_TRIES   — default 15 (attempts after tunnel start)
#   COLIMA_6443_API_PROBE_SLEEP   — default 2 (seconds between attempts)
#   COLIMA_6443_CURL_MAX_TIME     — default 3 (seconds per curl)
#
# Run after colima start; safe to run multiple times (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

command -v curl >/dev/null 2>&1 || {
  echo "ERROR: curl required for API probe (install curl or use brew)"
  exit 1
}

SSH_CFG="${HOME}/.colima/_lima/colima/ssh.config"
PID_FILE="${HOME}/.colima/default/colima-6443-tunnel.pid"

API_TRIES="${COLIMA_6443_API_PROBE_TRIES:-15}"
API_SLEEP="${COLIMA_6443_API_PROBE_SLEEP:-2}"
CURL_MAX="${COLIMA_6443_CURL_MAX_TIME:-3}"

RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1

api_probe() {
  # k3s often returns 401 on /version without a client cert; that still proves TLS + apiserver responded.
  local code
  code=$(curl -k -s -o /dev/null -w "%{http_code}" --max-time "$CURL_MAX" "https://127.0.0.1:6443/version" 2>/dev/null || echo "000")
  case "$code" in
    2?? | 401 | 403) return 0 ;;
    *) return 1 ;;
  esac
}

pin_kubeconfig_to_tunnel() {
  local ctx cluster
  ctx=$(kubectl config current-context 2>/dev/null || true)
  if [[ "$ctx" == *"colima"* ]]; then
    cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
  fi
}

# Kill any existing tunnel (our PID file or any ssh -L 6443 to lima)
kill_existing_tunnel() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  local pids
  pids=$(pgrep -f "ssh.*-L.*6443:.*lima" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill 2>/dev/null || true
  fi
  sleep 1
}

# Healthy API through existing tunnel — skip unless --restart
if [[ "$RESTART" -eq 0 ]] && api_probe; then
  pin_kubeconfig_to_tunnel
  echo "OK: API reachable via tunnel (https://127.0.0.1:6443/version)"
  exit 0
fi

# TCP open but TLS/API dead — recycle tunnel
if nc -z 127.0.0.1 6443 2>/dev/null; then
  echo "WARN: 127.0.0.1:6443 accepts TCP but API probe failed - recycling tunnel"
  kill_existing_tunnel
fi

if [[ "$RESTART" -eq 1 ]]; then
  echo "  Restarting tunnel (killing existing)..."
  kill_existing_tunnel
fi

# Colima not running or no SSH config
if [[ ! -f "$SSH_CFG" ]]; then
  echo "WARN: Colima SSH config not found ($SSH_CFG). Start Colima first: colima start --with-kubernetes"
  exit 1
fi

echo "  Setting up tunnel 127.0.0.1:6443..."
kill_existing_tunnel

# Detect k3s port: prefer VM k3s.yaml (port changes after restart); fallback to host kubeconfig then 51819.
GUEST_PORT="51819"
if [[ -f "$SSH_CFG" ]]; then
  _raw=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null' 2>/dev/null | head -1)
  if [[ -n "$_raw" ]]; then
    _p=$(echo "$_raw" | sed -n 's/.*:\([0-9]*\)[^0-9]*/\1/p')
    [[ -n "$_p" ]] && GUEST_PORT="$_p"
  fi
fi
if [[ "$GUEST_PORT" == "51819" ]]; then
  _current_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  if [[ -n "$_current_server" ]]; then
    _p=$(echo "$_current_server" | sed -n 's/.*:\([0-9]*\)$/\1/p')
    if [[ -n "$_p" ]] && [[ "$_p" != "6443" ]]; then
      GUEST_PORT="$_p"
    fi
  fi
fi

# Start tunnel: host 6443 -> guest 127.0.0.1:$GUEST_PORT
mkdir -p "$(dirname "$PID_FILE")"
_ssh_err=$(mktemp 2>/dev/null || echo "/tmp/colima-ssh-$$")
if ! ssh -F "$SSH_CFG" -o ConnectTimeout=10 -o StrictHostKeyChecking=no -L "6443:127.0.0.1:${GUEST_PORT}" lima-colima -N -f 2>"$_ssh_err"; then
  echo "WARN: Tunnel ssh failed (guest port ${GUEST_PORT}): $(head -n3 "$_ssh_err" 2>/dev/null || true)"
  rm -f "$_ssh_err"
fi
sleep 1
tunnel_pid=$(pgrep -f "ssh.*-L.*6443:127.0.0.1:${GUEST_PORT}" 2>/dev/null | head -1)
if [[ -n "$tunnel_pid" ]]; then
  echo "$tunnel_pid" >"$PID_FILE"
fi
rm -f "$_ssh_err"

pin_kubeconfig_to_tunnel
echo "  Pinned kubeconfig to https://127.0.0.1:6443 (tunnel -> guest ${GUEST_PORT})"

# Real API check (TLS + HTTP) — not nc-only
for ((i = 1; i <= API_TRIES; i++)); do
  if api_probe; then
    echo "OK: API reachable via tunnel (https://127.0.0.1:6443/version)"
    echo "   Heavy kubectl: run ./scripts/colima-api-health.sh first if you see flakes."
    exit 0
  fi
  sleep "$API_SLEEP"
done

echo "ERROR: API NOT reachable over tunnel after ${API_TRIES} attempts (${API_SLEEP}s apart)."
echo "   Try: colima status; $0 --restart; or colima stop && colima start --with-kubernetes"
exit 1
