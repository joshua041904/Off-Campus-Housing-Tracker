#!/usr/bin/env bash
# Make MetalLB LB IP reachable from the host: loopback alias + socat TCP 443 and UDP 443 → NodePort.
# Optional: Docker bridge 0.0.0.0:18443 → NodePort so containers can use host.docker.internal:18443 for HTTP/3.
# Optional: On Colima (macOS), start UDP NODEPORT forwarder 127.0.0.1:NODEPORT → VM_IP:NODEPORT so HTTP/3 via LB IP
# reaches Caddy in the VM. VM IP: prefer "src" from colima ssh -- ip route get 1.1.1.1 (not the gateway); no "colima ip" needed.
# Disable Colima forwarder: START_COLIMA_30443=0. VM IP is auto-detected (src from route, then eth0 inet). COLIMA_IP_OVERRIDE= only if auto-detect fails (use VM IP e.g. 192.168.5.1, never gateway .2).
# Usage: LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh  (re-execs with sudo if needed)
# See docs/HTTP3-LB-IP-FIX-CHECKLIST.md, docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md, and docs/COLIMA_NETWORK_ADDRESS_AND_LB_IP.md (direct LB IP with --network-address, no socat).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LB_IP="${LB_IP:-}"
NODEPORT="${NODEPORT:-30443}"
DOCKER_BRIDGE_PORT="${DOCKER_BRIDGE_PORT:-18443}"
START_DOCKER_BRIDGE="${START_DOCKER_BRIDGE:-1}"
CADDY_DIRECT="${CADDY_DIRECT:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# Detect LB_IP from cluster if not set
if [[ -z "$LB_IP" ]] && command -v kubectl >/dev/null 2>&1; then
  LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  [[ -z "$LB_IP" ]] && LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.externalIPs[0]}' 2>/dev/null || true)
fi
# When run with sudo, env vars are often not passed; try well-known files written by verify-metallb or user
if [[ -z "$LB_IP" ]] && [[ -r /tmp/metallb-reachable.env ]]; then
  _val=$(grep -E '^REACHABLE_LB_IP=' /tmp/metallb-reachable.env 2>/dev/null | cut -d= -f2- | tr -d '"'\''')
  [[ -n "$_val" ]] && LB_IP="$_val"
fi
if [[ -z "$LB_IP" ]] && [[ -r /tmp/lb-ip.env ]]; then
  _val=$(grep -E '^LB_IP=' /tmp/lb-ip.env 2>/dev/null | cut -d= -f2- | tr -d '"'\''')
  [[ -n "$_val" ]] && LB_IP="$_val"
fi
if [[ -z "$LB_IP" ]]; then
  echo "❌ LB_IP not set and could not detect from cluster. Export LB_IP (e.g. from kubectl -n ingress-nginx get svc caddy-h3)."
  echo "   With sudo, env is often stripped. Use one of:"
  echo "   • LB_IP=192.168.5.240 ./scripts/setup-lb-ip-host-access.sh   (script will re-exec with sudo and keep LB_IP)"
  echo "   • sudo -E LB_IP=192.168.5.240 ./scripts/setup-lb-ip-host-access.sh"
  echo "   • echo 'LB_IP=192.168.5.240' > /tmp/lb-ip.env && sudo ./scripts/setup-lb-ip-host-access.sh"
  echo "   For LoadBalancer type: kubectl apply -f infra/k8s/loadbalancer.yaml (or caddy-h3-service-loadbalancer.yaml); MetalLB will set EXTERNAL-IP."
  exit 1
fi

# Re-exec with sudo so we can bind to 443 and add lo0 alias (no need for user to type sudo).
# Pass COLIMA_BIN so when running as root we can still find colima (often not in root's PATH).
if [[ $(id -u) -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
  _colima_path="$(command -v colima 2>/dev/null)" || true
  [[ -z "$_colima_path" ]] && [[ -x /opt/homebrew/bin/colima ]] && _colima_path="/opt/homebrew/bin/colima"
  [[ -z "$_colima_path" ]] && [[ -x /usr/local/bin/colima ]] && _colima_path="/usr/local/bin/colima"
  export COLIMA_BIN="${_colima_path:-}"
  exec sudo -E COLIMA_BIN="$COLIMA_BIN" LB_IP="$LB_IP" NODEPORT="$NODEPORT" START_DOCKER_BRIDGE="$START_DOCKER_BRIDGE" CADDY_DIRECT="$CADDY_DIRECT" DOCKER_BRIDGE_PORT="$DOCKER_BRIDGE_PORT" START_COLIMA_30443="${START_COLIMA_30443:-1}" "$0"
fi

# Prefer Homebrew curl for HTTP/3 (system curl on macOS does not support --http3-only)
_curl_has_http3() { [[ -x "${1:-}" ]] && "$1" --help all 2>/dev/null | grep -q -- "--http3"; }
if [[ -n "${CURL_BIN:-}" ]] && _curl_has_http3 "$CURL_BIN"; then
  CURL_HTTP3="$CURL_BIN"
elif _curl_has_http3 /opt/homebrew/opt/curl/bin/curl; then
  CURL_HTTP3="/opt/homebrew/opt/curl/bin/curl"
elif _curl_has_http3 /usr/local/opt/curl/bin/curl; then
  CURL_HTTP3="/usr/local/opt/curl/bin/curl"
elif _curl_has_http3 "$(command -v curl 2>/dev/null)"; then
  CURL_HTTP3="$(command -v curl)"
else
  CURL_HTTP3=""
fi
unset -f _curl_has_http3 2>/dev/null || true

PID_DIR="${TMPDIR:-/tmp}"
SAFE_LB=$(echo "$LB_IP" | tr '.' '_')
TCP_PID_FILE="$PID_DIR/lb-ip-socat-tcp-${SAFE_LB}.pid"
UDP_PID_FILE="$PID_DIR/lb-ip-socat-udp-${SAFE_LB}.pid"
UDP_LOG="$PID_DIR/lb-ip-socat-udp.log"
DOCKER_BRIDGE_PID_FILE="$PID_DIR/lb-ip-docker-bridge-${SAFE_LB}.pid"

[[ "$LB_IP" != "" ]] && info "Using LB_IP=$LB_IP"

# Colima + MetalLB: try direct LB IP first (no alias, no socat). verify-metallb expects this path; socat breaks HTTP/3 reply path.
# If direct works, we only write metallb-reachable.env and exit. No sudo needed for that when already root.
USE_DIRECT_LB="${COLIMA_DIRECT_LB:-${USE_DIRECT_LB:-0}}"
_ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$(uname -s)" == "Darwin" ]] && [[ "$_ctx" == *"colima"* ]] && command -v colima &>/dev/null 2>&1; then
  colima list 2>/dev/null | grep -q "running" && USE_DIRECT_LB=1
fi
if [[ "$USE_DIRECT_LB" == "1" ]] || [[ "${COLIMA_DIRECT_LB:-0}" == "1" ]]; then
  # Prefer Homebrew curl for HTTP/3 (system curl often lacks --http3-only)
  [[ -z "${CURL_HTTP3:-}" ]] && [[ -x /opt/homebrew/opt/curl/bin/curl ]] && CURL_HTTP3=/opt/homebrew/opt/curl/bin/curl
  # Remove alias if present so curl goes to the network (VM), not loopback
  if ifconfig lo0 2>/dev/null | grep -q "$LB_IP"; then
    info "Removing existing lo0 alias $LB_IP to test direct path"
    sudo ifconfig lo0 -alias "$LB_IP" 2>/dev/null || true
    sleep 1
  fi
  _h2=$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 8 --resolve "off-campus-housing.local:443:$LB_IP" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$_h2" == "200" ]]; then
    _h3="000"
    if [[ -n "$CURL_HTTP3" ]] && [[ -x "$CURL_HTTP3" ]]; then
      _h3=$(NGTCP2_ENABLE_GSO=0 "$CURL_HTTP3" --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 --resolve "off-campus-housing.local:443:$LB_IP" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || echo "000")
    fi
    METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
    echo "REACHABLE_LB_IP=$LB_IP" > "$METALLB_ENV"
    echo "USE_LB_FOR_TESTS=1" >> "$METALLB_ENV"
    echo "NODEPORT=$NODEPORT" >> "$METALLB_ENV"
    echo "COLIMA_DIRECT_LB=1" >> "$METALLB_ENV"
    if [[ "$_h3" == "200" ]]; then
      ok "Direct LB IP $LB_IP reachable (HTTP/2 + HTTP/3). No socat needed — use verify-metallb-and-traffic-policy.sh."
      info "Wrote $METALLB_ENV. Run suites; they will use LB IP directly."
    else
      ok "Direct LB IP $LB_IP reachable (HTTP/2). HTTP/3 from host may need in-VM curl or bridged network."
      info "Wrote $METALLB_ENV. For HTTP/3 from Mac: use bridged Colima or run curl inside VM."
    fi
    exit 0
  fi
  info "Direct LB IP not reachable; will use alias + socat (HTTP/3 via socat may have reply-path issues)."
fi

# Kill existing holders of TCP 443 and UDP 443 so we can bind (run twice with short sleep so port is released)
_kill_port() {
  local proto=$1 port=$2
  PIDS=$(lsof -t -i ${proto}:${port} 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    return 0
  fi
  return 1
}
for _pass in 1 2; do
  for proto in UDP TCP; do
    PIDS=$(lsof -t -i ${proto}:443 2>/dev/null || true)
    if [[ -n "$PIDS" ]]; then
      say "Killing existing ${proto} 443 holders (pass $_pass): $PIDS"
      echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
  done
  sleep 2
done

# Remove existing alias then add so it's clean
if ifconfig lo0 2>/dev/null | grep -q "$LB_IP"; then
  info "Removing existing lo0 alias $LB_IP"
  sudo ifconfig lo0 -alias "$LB_IP" 2>/dev/null || true
  sleep 1
fi
say "Adding loopback alias $LB_IP"
sudo ifconfig lo0 alias "$LB_IP"
ok "lo0 alias $LB_IP added"

# Start UDP before TCP: on macOS, binding TCP to LB_IP:443 first can block UDP on the same address.
# Something on the system keeps re-binding to UDP 443; kill immediately before starting so we win the race.
# UDP 443 → NodePort. fork so each client gets a process and QUIC replies go to the right client.
say "Starting socat UDP 443 → 127.0.0.1:$NODEPORT (fork for QUIC)"
: > "$UDP_LOG"
UDP_OK=0
for _udp_try in 1 2 3; do
  [[ $_udp_try -gt 1 ]] && say "Retrying UDP 443 (try $_udp_try)"
  _kill_port UDP 443
  sleep 0.4
  HOLDERS=$(lsof -t -i UDP:443 2>/dev/null || true)
  if [[ -n "$HOLDERS" ]]; then
    warn "UDP 443 still held by $HOLDERS after kill; killing again"
    _kill_port UDP 443
    sleep 0.3
  fi
  HOLDERS_NOW=$(lsof -t -i UDP:443 2>/dev/null || true)
  if [[ -n "$HOLDERS_NOW" ]]; then
    WHAT=$(ps -p $HOLDERS_NOW -o comm= 2>/dev/null | tr '\n' ' ' || true)
    info "UDP 443 holders before start: $HOLDERS_NOW ($WHAT)"
  else
    info "UDP 443 holders before start: none"
  fi
  sudo nohup socat UDP-LISTEN:443,reuseaddr,bind="$LB_IP",fork UDP:127.0.0.1:"$NODEPORT" >> "$UDP_LOG" 2>&1 &
  echo $! > "$UDP_PID_FILE"
  disown 2>/dev/null || true
  sleep 0.6
  if [[ -s "$UDP_PID_FILE" ]] && kill -0 "$(cat "$UDP_PID_FILE")" 2>/dev/null; then
    ok "UDP forwarder running (PID $(cat "$UDP_PID_FILE"), log: $UDP_LOG)"
    UDP_OK=1
    break
  fi
  [[ -f "$UDP_LOG" ]] && grep -q "Address already in use\|EADDRINUSE" "$UDP_LOG" 2>/dev/null && warn "UDP 443 in use (try $_udp_try)"
done
if [[ "$UDP_OK" -ne 1 ]]; then
  warn "UDP socat failed (check $UDP_LOG). Another process may be binding UDP 443; list with: lsof -i UDP:443"
fi

# TCP 443 → NodePort (or port-forward when CADDY_DIRECT=1)
if [[ "${CADDY_DIRECT:-0}" == "1" ]]; then
  info "CADDY_DIRECT=1: skipping TCP socat (use port-forward for TCP)"
else
  say "Starting socat TCP 443 → 127.0.0.1:$NODEPORT"
  sudo nohup socat TCP-LISTEN:443,reuseaddr,bind="$LB_IP",fork TCP:127.0.0.1:"$NODEPORT" >> /dev/null 2>&1 &
  echo $! > "$TCP_PID_FILE"
  disown 2>/dev/null || true
  sleep 1
  ok "TCP forwarder running (PID $(cat "$TCP_PID_FILE"))"
fi

# Optional: Docker bridge for containers (host.docker.internal:18443 → NodePort)
if [[ "$START_DOCKER_BRIDGE" == "1" ]]; then
  # Kill any previous Docker bridge socats so we don't get "Address already in use"
  for proto in UDP TCP; do
    PIDS=$(lsof -t -i ${proto}:"$DOCKER_BRIDGE_PORT" 2>/dev/null || true)
    if [[ -n "$PIDS" ]]; then
      info "Killing existing $proto $DOCKER_BRIDGE_PORT holders: $PIDS"
      echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
  done
  sleep 1
  say "Starting Docker bridge 0.0.0.0:$DOCKER_BRIDGE_PORT → 127.0.0.1:$NODEPORT (TCP+UDP)"
  # TCP
  sudo nohup socat TCP-LISTEN:"$DOCKER_BRIDGE_PORT",reuseaddr,fork TCP:127.0.0.1:"$NODEPORT" >> /dev/null 2>&1 &
  echo $! > "${DOCKER_BRIDGE_PID_FILE}.tcp"
  disown 2>/dev/null || true
  # UDP (fork for QUIC reply path)
  sudo nohup socat UDP-LISTEN:"$DOCKER_BRIDGE_PORT",reuseaddr,fork UDP:127.0.0.1:"$NODEPORT" >> "$UDP_LOG" 2>&1 &
  echo $! > "${DOCKER_BRIDGE_PID_FILE}.udp"
  disown 2>/dev/null || true
  echo "$DOCKER_BRIDGE_PORT" > "${PID_DIR}/lb-ip-docker-forward-port-${SAFE_LB}.txt"
  ok "Docker bridge port $DOCKER_BRIDGE_PORT (containers: host.docker.internal:$DOCKER_BRIDGE_PORT)"
fi

# Resolve colima once (for Colima forwarder and for failure tip). Root often has no colima in PATH under sudo.
_COLIMA_CMD="${COLIMA_BIN:-}"
[[ -z "$_COLIMA_CMD" ]] && _COLIMA_CMD="$(command -v colima 2>/dev/null)" || true
[[ -z "$_COLIMA_CMD" ]] && [[ -x /opt/homebrew/bin/colima ]] && _COLIMA_CMD="/opt/homebrew/bin/colima"
[[ -z "$_COLIMA_CMD" ]] && [[ -x /usr/local/bin/colima ]] && _COLIMA_CMD="/usr/local/bin/colima"

# Optional: Colima VM UDP forward (host 127.0.0.1:30443 → VM:30443) so HTTP/3 via LB IP can reach Caddy in the VM.
# Colima has no "colima ip" in some versions; get VM IP via colima ssh. When run under sudo, run colima as SUDO_USER
# so it finds the Colima socket (and so the forwarder process is owned by the user).
START_COLIMA_30443="${START_COLIMA_30443:-1}"
COLIMA_30443_PID_FILE="$PID_DIR/lb-ip-colima-30443-${SAFE_LB}.pid"
_colima_run() {
  if [[ -n "${SUDO_USER:-}" ]]; then
    sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-$(eval echo "~$SUDO_USER")}" "$_COLIMA_CMD" "$@"
  else
    "$_COLIMA_CMD" "$@"
  fi
}
if [[ "$(uname -s)" == "Darwin" ]] && [[ "$START_COLIMA_30443" == "1" ]] && [[ -n "$_COLIMA_CMD" ]] && [[ -x "$_COLIMA_CMD" ]]; then
  [[ -n "${SUDO_USER:-}" ]] && SUDO_HOME=$(eval echo "~$SUDO_USER" 2>/dev/null)
  # VM IP: always use VM's own address, never gateway. Colima: .1=VM, .2=host (from VM's view). Forwarder must target VM.
  # Detection order: (1) src from "ip route get", (2) eth0 inet, (3) first non-loopback. Do not use field 7 (can be gateway).
  _src_awk='/(^| )src /{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}'
  if [[ -n "${COLIMA_IP_OVERRIDE:-}" ]]; then
    COLIMA_IP="$COLIMA_IP_OVERRIDE"
    warn "COLIMA_IP_OVERRIDE=$COLIMA_IP_OVERRIDE — ensure this is the VM IP (e.g. 192.168.5.1), not the gateway (192.168.5.2), or QUIC will time out"
  else
    if [[ -n "${SUDO_USER:-}" ]]; then
      COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk "$_src_awk" || true)
      [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
      [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip -4 -o addr show 2>/dev/null | grep -v '127.0.0.1' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
    else
      COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk "$_src_awk" || true)
      [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
      [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip -4 -o addr show 2>/dev/null | grep -v '127.0.0.1' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
    fi
  fi
  _colima_running=0
  if [[ -n "$COLIMA_IP" ]]; then
    _colima_running=1
  else
    _colima_run status 2>/dev/null | grep -qi running && _colima_running=1
    if [[ "$_colima_running" == "1" ]]; then
      if [[ -n "${SUDO_USER:-}" ]]; then
        COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk '/(^| )src /{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
        [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
        [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(sudo -u "$SUDO_USER" env HOME="${SUDO_HOME:-/}" "$_COLIMA_CMD" ssh -- ip -4 -o addr show 2>/dev/null | grep -v '127.0.0.1' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
      else
        COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk '/(^| )src /{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
        [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
        [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$("$_COLIMA_CMD" ssh -- ip -4 -o addr show 2>/dev/null | grep -v '127.0.0.1' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
      fi
    fi
  fi
  if [[ "$_colima_running" == "1" ]] && [[ -n "$COLIMA_IP" ]]; then
    # TCP and UDP: 127.0.0.1:NODEPORT → VM:NODEPORT so socat (LB_IP:443 → 127.0.0.1:NODEPORT) can reach Caddy in the VM
    for _proto in TCP UDP; do
      PIDS=$(lsof -t -i ${_proto}:"$NODEPORT" 2>/dev/null || true)
      if [[ -n "$PIDS" ]]; then
        info "Killing existing $_proto $NODEPORT holders (for Colima forwarder): $PIDS"
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
        sleep 0.3
      fi
    done
    say "Starting Colima TCP forwarder 127.0.0.1:$NODEPORT → $COLIMA_IP:$NODEPORT (HTTP/2 via LB IP)"
    COLIMA_30443_TCP_PID="$PID_DIR/lb-ip-colima-30443-tcp-${SAFE_LB}.pid"
    if [[ -n "${SUDO_USER:-}" ]]; then
      sudo -u "$SUDO_USER" nohup socat TCP-LISTEN:"$NODEPORT",reuseaddr,fork TCP:"$COLIMA_IP:$NODEPORT" >> /dev/null 2>&1 &
    else
      nohup socat TCP-LISTEN:"$NODEPORT",reuseaddr,fork TCP:"$COLIMA_IP:$NODEPORT" >> /dev/null 2>&1 &
    fi
    echo $! > "$COLIMA_30443_TCP_PID"
    disown 2>/dev/null || true
    sleep 0.3
    if [[ -s "$COLIMA_30443_TCP_PID" ]] && kill -0 "$(cat "$COLIMA_30443_TCP_PID")" 2>/dev/null; then
      ok "Colima TCP forwarder running (PID $(cat "$COLIMA_30443_TCP_PID"))"
    else
      warn "Colima TCP forwarder may have exited; check port $NODEPORT (TCP)"
    fi
    say "Starting Colima UDP forwarder 127.0.0.1:$NODEPORT → $COLIMA_IP:$NODEPORT (HTTP/3 via LB IP)"
    if [[ -n "${SUDO_USER:-}" ]]; then
      sudo -u "$SUDO_USER" nohup socat UDP-LISTEN:"$NODEPORT",reuseaddr,fork UDP:"$COLIMA_IP:$NODEPORT" >> /dev/null 2>&1 &
    else
      nohup socat UDP-LISTEN:"$NODEPORT",reuseaddr,fork UDP:"$COLIMA_IP:$NODEPORT" >> /dev/null 2>&1 &
    fi
    echo $! > "$COLIMA_30443_PID_FILE"
    disown 2>/dev/null || true
    sleep 0.5
    if [[ -s "$COLIMA_30443_PID_FILE" ]] && kill -0 "$(cat "$COLIMA_30443_PID_FILE")" 2>/dev/null; then
      ok "Colima UDP forwarder running (PID $(cat "$COLIMA_30443_PID_FILE"))"
    else
      warn "Colima UDP forwarder may have exited; check port $NODEPORT (UDP)"
    fi
  fi
fi

# Persist for run-all-test-suites / MetalLB verify
METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
echo "REACHABLE_LB_IP=$LB_IP" > "$METALLB_ENV"
echo "USE_LB_FOR_TESTS=1" >> "$METALLB_ENV"
echo "NODEPORT=$NODEPORT" >> "$METALLB_ENV"
[[ -n "${DOCKER_BRIDGE_PORT:-}" ]] && echo "DOCKER_FORWARD_PORT=$DOCKER_BRIDGE_PORT" >> "$METALLB_ENV"
[[ -n "${COLIMA_IP:-}" ]] && echo "COLIMA_IP=$COLIMA_IP" >> "$METALLB_ENV"
info "Wrote $METALLB_ENV (REACHABLE_LB_IP, USE_LB_FOR_TESTS)"

say "Done. Quick verify (optional):"
sleep 2
VERIFY_H2=$(curl -k --http2 -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --resolve "off-campus-housing.local:443:$LB_IP" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || echo "000")
if [[ "$VERIFY_H2" == "200" ]]; then ok "HTTP/2 via LB IP: $VERIFY_H2"; else warn "HTTP/2 via LB IP: $VERIFY_H2 (expected 200)"; fi
if [[ -n "$CURL_HTTP3" ]]; then
  VERIFY_H3=$(NGTCP2_ENABLE_GSO=0 "$CURL_HTTP3" --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --resolve "off-campus-housing.local:443:$LB_IP" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null) || true
  [[ -z "$VERIFY_H3" ]] && VERIFY_H3="000"
else
  VERIFY_H3="000"
  warn "No curl with HTTP/3 found; install Homebrew curl: brew install curl (then re-run or use the manual test with the path below)"
fi
if [[ "$VERIFY_H3" == "200" ]]; then
  ok "HTTP/3 via LB IP: $VERIFY_H3"
else
  warn "HTTP/3 via LB IP: $VERIFY_H3 (expected 200)"
  LISTEN_443=$(lsof -i UDP:443 2>/dev/null | grep -v "^COMMAND" || true)
  if [[ -z "$LISTEN_443" ]] || ! echo "$LISTEN_443" | grep -q "$LB_IP"; then
    info "Tip: UDP 443 must be forwarded (socat bound to $LB_IP). Check: lsof -i UDP:443  (when run under sudo, socat is root-owned — use sudo lsof -i UDP:443). If empty, re-run this script."
  fi
  LISTEN_30443=$(lsof -t -i UDP:"$NODEPORT" 2>/dev/null || true)
  if [[ -z "$LISTEN_30443" ]]; then
    info "Tip: nothing is listening on UDP $NODEPORT on this host; QUIC needs the cluster's NodePort reachable at 127.0.0.1:$NODEPORT."
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && [[ -n "$_COLIMA_CMD" ]]; then
    _cip=$("$_COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)
    [[ -z "$_cip" ]] && _cip=$("$_COLIMA_CMD" ssh -- ip -4 -o addr show 2>/dev/null | grep -v '127.0.0.1' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
    if [[ -n "$_cip" ]]; then
      info "To restart Colima UDP forwarder after reboot (VM at $_cip):"
      echo "  socat UDP-LISTEN:$NODEPORT,reuseaddr,fork UDP:$_cip:$NODEPORT &"
      echo "  # VM IP: $_COLIMA_CMD ssh -- ip route get 1.1.1.1 | awk '{print \$7}'"
    fi
  fi
  _hex=$(printf '%04X' "$NODEPORT")
  info "If HTTP/3 still fails: (0) UDP 443->${NODEPORT} on Mac: lsof -i UDP:443  (1) UDP ${NODEPORT}->VM: lsof -i UDP:${NODEPORT}  (2) NodePort: kubectl -n ingress-nginx get svc caddy-h3  (3) VM listener: $_COLIMA_CMD ssh -- cat /proc/net/udp | grep $_hex"
fi
echo ""
info "Manual test (use Homebrew curl for HTTP/3; system curl does not support --http3-only):"
echo "  curl -k --http2 -sS -o /dev/null -w '%{http_code}' --resolve off-campus-housing.local:443:$LB_IP https://off-campus-housing.local/_caddy/healthz"
if [[ -n "$CURL_HTTP3" ]]; then
  echo "  NGTCP2_ENABLE_GSO=0 $CURL_HTTP3 --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --resolve off-campus-housing.local:443:$LB_IP https://off-campus-housing.local/_caddy/healthz"
  # Suggest making it default if we're using the full path (so plain 'curl' gets HTTP/3)
  if [[ "$CURL_HTTP3" == *"/opt/"* ]] || [[ "$CURL_HTTP3" == *"/usr/local/opt/"* ]]; then
    CURL_DIR="${CURL_HTTP3%/*}"
    info "To use this curl by default: export PATH=\"$CURL_DIR:\$PATH\"   (e.g. in .zshrc)"
  fi
else
  echo "  NGTCP2_ENABLE_GSO=0 /opt/homebrew/opt/curl/bin/curl --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --resolve off-campus-housing.local:443:$LB_IP https://off-campus-housing.local/_caddy/healthz   # requires: brew install curl"
fi
