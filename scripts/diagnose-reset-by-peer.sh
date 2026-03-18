#!/usr/bin/env bash
# Connection reset by peer: 5-layer TEACHING diagnostic.
# Runbook: Colima + k3s only (no Kind). See Runbook.md "RUNBOOK: Kubernetes API connection reset by peer".
#
# This is the key: teach in order so people stop panic, see reality, and stop
# butting the same bug (reissue step 2, in-VM port vs host tunnel, etc.).
#
# Usage: ./scripts/diagnose-reset-by-peer.sh [PORT]
#   PORT defaults to 6443.
#   HOST=127.0.0.1  TCPDUMP_SEC=5  — optional.
#   DEEP=1          — run full low-level checks (Colima, in-VM path, lsof, sockets).
#   DIAG_GATHER=1   — write full output to scripts/diag-reset-YYYYMMDD-HHMMSS.log
#
# Mental model: Resets are intent. Someone sent RST. Who? Why then? Under what load/path?

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

PORT="${1:-${PORT:-6443}}"
HOST="${HOST:-127.0.0.1}"
TCPDUMP_SEC="${TCPDUMP_SEC:-0}"
DEEP="${DEEP:-0}"
DIAG_GATHER="${DIAG_GATHER:-0}"

GATHER_FILE=""
if [[ "${DIAG_GATHER}" == "1" ]]; then
  GATHER_FILE="$SCRIPT_DIR/diag-reset-$(date +%Y%m%d-%H%M%S).log"
  echo "  (Gathering full output to $GATHER_FILE)"
fi

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }
lesson() { echo "  📌 Lesson: $*"; }

if [[ -n "$GATHER_FILE" ]]; then
  mkdir -p "$SCRIPT_DIR"
  exec 1> >(tee -a "$GATHER_FILE") 2>&1
fi

say "=== Connection reset by peer: 5-layer teaching playbook (port $PORT) ==="
echo "  Resets = intent. Who reset? Why then? Under what load / path / cert?"
echo "  Full playbook: scripts/CONNECTION-RESET-PLAYBOOK.md"
[[ "$DEEP" == "1" ]] && echo "  Mode: DEEP=1 (path divergence, Colima in-VM, sockets)"
[[ -n "$GATHER_FILE" ]] && echo "  Log: $GATHER_FILE"
echo ""

# ---------------------------------------------------------------------------
# Layer 1 — Symptom classification (~5 min)
# Goal: Stop panic. Reads vs writes are different; success ≠ stability.
# ---------------------------------------------------------------------------
say "Layer 1 — Symptom classification (read vs write)"
echo "  Goal: Stop panic. Classify: reachability vs stability."
echo ""
_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
echo "  Commands:"
echo "    kubectl get nodes"
echo "    kubectl create ns test"
echo "  Kubeconfig server: ${_server:-<none>}"
read_ok=0
write_ok=0
_layer1_err=$(mktemp 2>/dev/null || echo "/tmp/diag-layer1-$$.err")
if kubectl get nodes --request-timeout=10s >/dev/null 2>"$_layer1_err"; then
  read_ok=1
  ok "kubectl get nodes — read path OK (API reachable)"
  if kubectl create ns test-reset-debug-$$ --request-timeout=15s 2>/dev/null; then
    kubectl delete ns test-reset-debug-$$ --request-timeout=10s 2>/dev/null || true
    write_ok=1
    ok "kubectl create ns — write path OK"
  else
    warn "kubectl create ns failed or reset → write-path problem (this is what reissue step 2 hits)."
  fi
else
  _layer1_text=$(cat "$_layer1_err" 2>/dev/null)
  if echo "$_layer1_text" | grep -qi "ServiceUnavailable\|503\|unable to handle the request"; then
    warn "kubectl get nodes failed — API server returned 503 (overloaded or still starting). Not a tunnel/reset."
    echo "    Run: $REPO_ROOT/scripts/colima-api-status.sh  (k3s status + recovery)"
    echo "    Then: colima ssh -- sudo systemctl restart k3s   # wait ~60s and retry"
    echo "    Or:   $REPO_ROOT/scripts/colima-teardown-and-start.sh  (full teardown + tunnel)"
  else
    warn "kubectl get nodes failed → transport / tunnel / kubeconfig."
    echo "    Run: ./scripts/colima-forward-6443.sh or pin to native port. See Runbook.md item 32."
  fi
  [[ -n "$_layer1_text" ]] && echo "$_layer1_text" | head -2 | sed 's/^/    /'
fi
rm -f "$_layer1_err"
lesson "Reads test reachability; writes test stability. Success on get nodes ≠ stability on create secret."
echo ""

# ---------------------------------------------------------------------------
# Layer 2 — Transport truth (~10 min)
# Goal: Prove reality. The network is not flaky — something is choosing to reset.
# ---------------------------------------------------------------------------
say "Layer 2 — Transport truth (prove it's a reset)"
echo "  Goal: Prove reality. RST in packets = someone chose to close the connection."
echo ""
echo "  Commands (run while you reproduce the failure):"
echo "    Terminal 1: sudo tcpdump -nn -i lo0 tcp port $PORT 2>&1 | tee /tmp/rst-$PORT.log"
echo "    Terminal 2: run the failing command (e.g. kubectl create secret ... or preflight)"
echo "    Then: grep -E 'R |RST|rst' /tmp/rst-$PORT.log"
echo "  Or one-shot capture: TCPDUMP_SEC=10 $0 $PORT"
if [[ "${TCPDUMP_SEC}" -gt 0 ]] && command -v tcpdump >/dev/null 2>&1; then
  _pcap="/tmp/rst-$PORT-$$.pcap"
  info "Capturing for ${TCPDUMP_SEC}s to $_pcap (may need sudo)..."
  if command -v timeout >/dev/null 2>&1; then
    timeout "${TCPDUMP_SEC}" tcpdump -nn -i lo0 "tcp port $PORT" -w "$_pcap" 2>/dev/null || true
  else
    ( tcpdump -nn -i lo0 "tcp port $PORT" -w "$_pcap" 2>/dev/null & _tp=$!; sleep "${TCPDUMP_SEC}"; kill $_tp 2>/dev/null; wait $_tp 2>/dev/null; true )
  fi
  if [[ -s "$_pcap" ]]; then
    _rst=$(tcpdump -r "$_pcap" -nn 'tcp[tcpflags] & tcp-rst != 0' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "${_rst:-0}" -gt 0 ]]; then
      warn "Found $_rst RST packet(s) in capture."
    else
      info "No RST in capture (may be timeout/drop, not reset)."
    fi
    rm -f "$_pcap"
  fi
fi
lesson "The network is not flaky. Something is choosing to reset. This is where minds snap into place."
echo ""

# ---------------------------------------------------------------------------
# Layer 3 — TLS boundary (~10 min)
# Goal: Eliminate red herrings. TLS success ≠ app success; certs not always the villain.
# ---------------------------------------------------------------------------
say "Layer 3 — TLS boundary (eliminate red herrings)"
echo "  Goal: Eliminate red herrings. Prove TLS is not the cause."
echo ""
echo "  Commands:"
echo "    openssl s_client -connect ${HOST}:${PORT} -servername kubernetes"
echo "    curl -k https://${HOST}:${PORT}/version"
echo ""
if command -v openssl >/dev/null 2>&1; then
  _out=$(mktemp 2>/dev/null || echo "/tmp/openssl-$$.out")
  _exitfile=$(mktemp 2>/dev/null || echo "/tmp/openssl-$$.exit")
  ( echo "" | openssl s_client -connect "${HOST}:${PORT}" -servername kubernetes 2>"$_out"; echo $? > "$_exitfile" ) &
  _pid=$!
  sleep 5
  kill $_pid 2>/dev/null; wait $_pid 2>/dev/null; true
  _exit=$(cat "$_exitfile" 2>/dev/null || echo "1")
  echo "  openssl s_client output (first 35 lines):"
  head -35 "$_out" 2>/dev/null | sed 's/^/    /'
  rm -f "$_out" "$_exitfile"
  if [[ "$_exit" == "0" ]]; then
    ok "TLS handshake completed."
    echo "    → Reset happens AFTER TLS (during HTTP/API). Not cert/ALPN/SNI."
  else
    warn "openssl s_client failed or reset → TLS/SNI/ALPN or upstream issue."
  fi
else
  echo "    (openssl not found)"
fi
if command -v curl >/dev/null 2>&1; then
  _curl_exit=1
  _curl_out=$(curl -k -s -o /dev/null -w "%{http_code}" -m 15 "https://${HOST}:${PORT}/version" 2>/dev/null) || true
  if [[ "$_curl_out" == "200" ]]; then
    _curl_exit=0
    ok "curl /version returned 200"
  fi
  if [[ "$_curl_exit" -ne 0 ]]; then
    echo "  curl -k -v -m 15 https://${HOST}:${PORT}/version (first 25 lines):"
    curl -k -v -m 15 "https://${HOST}:${PORT}/version" 2>&1 | head -25 | sed 's/^/    /'
  fi
fi
lesson "TLS success ≠ app success. Certs are not always the villain. Huge for people who think TLS broke it."
echo ""

# ---------------------------------------------------------------------------
# Layer 4 — Path divergence (~15 min)
# Goal: Reveal the real cause. Same API, different access path; tunnels are stateful.
# ---------------------------------------------------------------------------
say "Layer 4 — Path divergence (same API, different path)"
echo "  Goal: Reveal the real cause. Host kubectl vs colima ssh kubectl vs in-VM k3s port."
echo ""
echo "  Commands:"
echo "    lsof -i :$PORT"
echo "    ps aux | grep ssh"
echo "    colima ssh -- kubectl get nodes"
echo ""
echo "  lsof -i :$PORT (first 20):"
lsof -i ":$PORT" 2>/dev/null | head -20 | sed 's/^/    /' || true
echo "  Processes: ssh, colima, limactl (relevant to $PORT):"
ps aux 2>/dev/null | grep -E 'ssh.*6443|ssh.*-L.*6443|colima|limactl' | grep -v grep | sed 's/^/    /' || true

# Path divergence: host vs in-VM
_host_get_nodes=0
_vm_get_nodes=0
_vm_server=""
if kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
  _host_get_nodes=1
  ok "Host: kubectl get nodes — OK (via ${HOST}:${PORT})"
else
  warn "Host: kubectl get nodes — failed (tunnel down or wrong port)"
fi

if command -v colima >/dev/null 2>&1 && colima status 2>/dev/null | grep -q "Running"; then
  if colima ssh -- kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
    _vm_get_nodes=1
    ok "In-VM: colima ssh -- kubectl get nodes — OK (VM default kubeconfig)"
  else
    warn "In-VM: colima ssh -- kubectl get nodes — failed (VM default kubeconfig)"
    # In-VM might use k3s.yaml with a different port (e.g. 49524); that port can be refused under load or be stale
    _k3s_line=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1' 2>/dev/null || true)
    if [[ -n "$_k3s_line" ]]; then
      _vm_server=$(echo "$_k3s_line" | sed -n 's/.*server:[ 	]*\(https:\/\/[^ 	]*\).*/\1/p' | tr -d ' ')
      echo "    In-VM k3s.yaml server: ${_vm_server:-<none>}"
      if [[ -n "$_vm_server" ]]; then
        if colima ssh -- kubectl --server="$_vm_server" get nodes --request-timeout=8s >/dev/null 2>&1; then
          _vm_get_nodes=1
          ok "In-VM: kubectl --server=$_vm_server get nodes — OK (k3s.yaml port works now)"
        else
          warn "In-VM: kubectl --server=$_vm_server get nodes — connection refused"
          echo "    → Reissue step 2 uses this URL; when it refuses, port is ephemeral or k3s moved. Use VM default kubeconfig (no --server) or host kubectl."
        fi
      fi
    fi
    if [[ "$_vm_get_nodes" -eq 0 ]] && [[ -z "$_vm_server" ]]; then
      echo "    (no /etc/rancher/k3s/k3s.yaml or unreadable)"
    fi
  fi
else
  info "Colima not running or not in PATH; skip in-VM path."
fi

if [[ "$_host_get_nodes" -eq 1 ]] && [[ "$_vm_get_nodes" -eq 0 ]]; then
  echo "  Path divergence: host API OK, in-VM API failed → tunnel forwards to host; inside VM use VM kubeconfig or fix in-VM port."
fi
if [[ "$_host_get_nodes" -eq 0 ]] && [[ "$_vm_get_nodes" -eq 1 ]]; then
  echo "  Path divergence: in-VM API OK, host failed → host tunnel (e.g. 6443) down; use colima ssh for kubectl or re-establish tunnel."
fi
lesson "Same API, different access path. Tunnels are stateful. Control plane access path matters. This is where infra thinking is born."
echo ""

# ---------------------------------------------------------------------------
# Layer 5 — Load correlation (~15 min)
# Goal: Connect cause to timing. Burst ≠ scale; resets are a pressure response.
# ---------------------------------------------------------------------------
say "Layer 5 — Load correlation (cause vs timing)"
echo "  Goal: Connect cause to timing. Resets often happen on first heavy write or under burst."
echo ""
echo "  Commands (to reproduce / correlate):"
echo "    pgbench / k6 run … (load)"
echo "    for i in 1 2 3 4 5; do kubectl create secret generic test-\$i --from-literal=a=b -n default; done"
echo "    (or run full preflight; reissue step 2 is a burst of create secret)"
echo ""
if command -v kubectl >/dev/null 2>&1 && kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  echo "  Recent cluster events (last 20):"
  kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -20 | sed 's/^/    /' || true
  if [[ "$DEEP" == "1" ]]; then
    echo "  kube-system pods (restarts):"
    kubectl get pods -n kube-system 2>/dev/null | sed 's/^/    /' || true
  fi
else
  echo "  (kubectl not reachable; skip events)"
fi
lesson "Burst ≠ scale. Resets are a pressure response. Health ≠ capacity. Senior-level insight."
echo ""

# ---------------------------------------------------------------------------
# DEEP: Low-level Colima, ports, sockets (when DEEP=1)
# ---------------------------------------------------------------------------
if [[ "$DEEP" == "1" ]]; then
  say "DEEP — Colima, ports, sockets"
  info "No kubectl required; proves tunnel vs native vs nothing."
  if command -v colima >/dev/null 2>&1; then
    echo "  colima status:"
    colima status 2>&1 | sed 's/^/    /' || true
    echo "  colima list (if available):"
    colima list 2>&1 | sed 's/^/    /' || true
  fi
  echo "  Port reachability (nc -zv):"
  for _p in 6443 51819 49400; do
    if nc -zv 127.0.0.1 "$_p" 2>/dev/null; then _u="open"; else _u="closed/unreachable"; fi
    echo "    127.0.0.1:$_p — $_u"
  done
  echo "  Tunnel PID file: $HOME/.colima/default/colima-6443-tunnel.pid"
  if [[ -f "$HOME/.colima/default/colima-6443-tunnel.pid" ]]; then
    _pid=$(cat "$HOME/.colima/default/colima-6443-tunnel.pid" 2>/dev/null)
    if [[ -n "$_pid" ]] && kill -0 "$_pid" 2>/dev/null; then ok "Tunnel PID $_pid is running"; else warn "Tunnel PID file exists but process $_pid not running"; fi
  else
    echo "    (no tunnel PID file)"
  fi
  _listen=$(lsof -i ":$PORT" 2>/dev/null | grep -c LISTEN 2>/dev/null) || true
  _est=$(lsof -i ":$PORT" 2>/dev/null | grep -c ESTABLISHED 2>/dev/null) || true
  echo "  Socket count for $PORT: LISTEN=${_listen:-0} ESTABLISHED=${_est:-0}"
  echo ""
  say "DEEP — HTTP layer (curl + kubectl verbose)"
  if command -v curl >/dev/null 2>&1; then
    echo "  curl -k -v -m 15 https://${HOST}:${PORT}/version (first 40 lines):"
    curl -k -v -m 15 "https://${HOST}:${PORT}/version" 2>&1 | head -40 | sed 's/^/    /'
  fi
  echo "  kubectl get nodes --v=6 --request-timeout=15s (first 30 lines):"
  kubectl get nodes --v=6 --request-timeout=15s 2>&1 | head -30 | sed 's/^/    /' || true
  echo ""
fi

# ---------------------------------------------------------------------------
# Summary and reproduce instructions
# ---------------------------------------------------------------------------
say "Summary"
echo "  If Layer 1 write fails but read OK     → write-path / tunnel stability (reissue step 2)."
echo "  If Layer 2 shows RST                   → someone (tunnel, apiserver, proxy) is closing the connection."
echo "  If Layer 3 TLS OK but kubectl resets  → problem is after TLS (HTTP/API or tunnel under load)."
echo "  If Layer 4 host OK, in-VM refused      → in-VM k3s port (e.g. from k3s.yaml) is ephemeral or wrong; use VM default kubeconfig or host."
echo "  If Layer 5 burst triggers reset       → control plane or tunnel under pressure; warm tunnel, space out writes, or use colima ssh for step 2."
echo ""
echo "  Mitigations: REISSUE_STEP2_VIA_SSH=1 (preflight); VM default kubeconfig in reissue when k3s.yaml port refuses; colima-forward-6443.sh; Runbook item 32."
echo ""
say "Reproduce (see Layer 2 for RST)"
echo "  Terminal 1: sudo tcpdump -nn -i lo0 tcp port $PORT 2>&1 | tee /tmp/rst-$PORT.log"
echo "  Terminal 2: RUN_FULL_LOAD=0 bash $REPO_ROOT/scripts/run-preflight-scale-and-all-suites.sh"
echo "  Then: grep -E 'R |RST|rst' /tmp/rst-$PORT.log"
echo "  Full diagnostic with log: DEEP=1 DIAG_GATHER=1 $0 $PORT"
echo ""
say "When stuck: run these in another terminal (observability)"
echo "  # Quick status (what is running / what is not):"
echo "  $REPO_ROOT/scripts/colima-api-status.sh"
echo ""
echo "  # Colima + tunnel:"
echo "  colima status"
echo "  lsof -i :$PORT | head -5"
echo "  nc -zv 127.0.0.1 $PORT"
echo ""
echo "  # Host vs in-VM API:"
echo "  kubectl get nodes --request-timeout=5s && echo host:OK || echo host:FAIL"
echo "  colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --request-timeout=5s && echo in-VM:OK || echo in-VM:FAIL"
echo ""
echo "  # In-VM detail (why in-VM might fail):"
echo "  colima ssh -- sh -c 'test -r /etc/rancher/k3s/k3s.yaml && echo k3s.yaml:readable || echo k3s.yaml:not-readable; which kubectl; env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes 2>&1'"
echo ""
echo "  # Re-establish tunnel then retry:"
echo "  $REPO_ROOT/scripts/colima-forward-6443.sh"
echo "  kubectl get nodes"
[[ -n "$GATHER_FILE" ]] && echo ""
echo "  Log written: $GATHER_FILE"
say "Done."
