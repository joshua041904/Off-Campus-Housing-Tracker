#!/usr/bin/env bash
# Ensure Kubernetes API is reachable at 127.0.0.1:6443 on the host.
# Colima often exposes k3s on a different port (e.g. 51819) in the VM; this script
# starts an SSH tunnel so host 6443 -> guest <k3s-port>, then sets kubeconfig to 6443.
# Use: ./scripts/colima-forward-6443.sh [--restart]
#   --restart  kill any existing tunnel and start fresh (use when you see "connection reset by peer")
# Run after colima start; safe to run multiple times (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

SSH_CFG="${HOME}/.colima/_lima/colima/ssh.config"
PID_FILE="${HOME}/.colima/default/colima-6443-tunnel.pid"

RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1

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

# Already reachable — skip unless --restart (stale tunnel can pass nc but then "connection reset by peer")
if [[ "$RESTART" -eq 0 ]] && nc -z 127.0.0.1 6443 2>/dev/null; then
  ctx=$(kubectl config current-context 2>/dev/null || true)
  if [[ "$ctx" == *"colima"* ]]; then
    cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
  fi
  echo "✅ 127.0.0.1:6443 already reachable"
  echo "   If kubectl fails with 'connection reset by peer', run: $0 --restart"
  exit 0
fi

if [[ "$RESTART" -eq 1 ]]; then
  echo "  Restarting tunnel (killing existing)..."
  kill_existing_tunnel
fi

# Colima not running or no SSH config
if [[ ! -f "$SSH_CFG" ]]; then
  echo "⚠️  Colima SSH config not found ($SSH_CFG). Start Colima first: colima start --with-kubernetes"
  exit 1
fi

echo "  Setting up tunnel 127.0.0.1:6443..."
kill_existing_tunnel

# Detect k3s port: prefer VM k3s.yaml (port changes after restart); fallback to host kubeconfig then 51819.
# Use colima ssh when possible (colima status can fail with "empty value" even when VM is up).
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
  echo "⚠️  Tunnel ssh failed (guest port ${GUEST_PORT}): $(cat "$_ssh_err" 2>/dev/null | head -3)"
  rm -f "$_ssh_err"
fi
sleep 1
tunnel_pid=$(pgrep -f "ssh.*-L.*6443:127.0.0.1:${GUEST_PORT}" 2>/dev/null | head -1)
if [[ -n "$tunnel_pid" ]]; then
  echo "$tunnel_pid" > "$PID_FILE"
fi
rm -f "$_ssh_err"

# Pin kubeconfig to 6443 immediately so kubectl uses the tunnel (k3s may not be ready yet)
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]]; then
  cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
  kubectl config set-cluster "$cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
  echo "  Pinned kubeconfig to https://127.0.0.1:6443 (tunnel -> guest ${GUEST_PORT})"
fi

# Verify tunnel accepts connections (k3s on guest may still be starting)
for i in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z 127.0.0.1 6443 2>/dev/null; then
    echo "✅ Tunnel running: 127.0.0.1:6443 -> guest 127.0.0.1:${GUEST_PORT}"
    exit 0
  fi
  sleep 1
done
echo "✅ Tunnel up (kubectl uses 6443). API may still be starting — wait or run colima-api-status.sh"
exit 0
