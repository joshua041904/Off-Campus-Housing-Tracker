#!/usr/bin/env bash
# Shared packet capture: start/stop/analyze/compare.
# Used by baseline, enhanced, and rotation test suites.
# Ensures tcpdump is available in pods, captures correctly, and analysis is consistent.
# All kubectl exec calls use --request-timeout=15s so we never hang on API server.
#
# Colima-safe: stop is non-blocking and timeout-safe. We never wait unbounded on kubectl exec or tcpdump.
#   DISABLE_PACKET_CAPTURE=1  — skip starting capture (suite never blocks on capture).
#   FAST_CAPTURE=1            — no drain, no first-packet analysis; stop via in-pod pkill with 5s timeout then proceed.
#   CAPTURE_STOP_TIMEOUT=N   — entire stop phase bounded; when set, drain/analyze minimized so suite proceeds.

# Host PIDs of "kubectl exec ... tcpdump" (tcpdump runs in foreground in pod; exec session kept alive on host)
_CAPTURE_PIDS=()
_CAPTURE_PODS=()
_CAPTURE_NS=()
_CAPTURE_DIR=""
KUBECTL_EXEC_TIMEOUT="${KUBECTL_EXEC_TIMEOUT:-15s}"

packet_capture_dir() {
  echo "${_CAPTURE_DIR:-/tmp/packet-captures-$$}"
}

_capture_kubectl() {
  kubectl --request-timeout="$KUBECTL_EXEC_TIMEOUT" "$@"
}

# Start capture on a pod. Usage: start_capture <namespace> <pod> [pcap-filter]
# Filter default: tcp port 443, tcp port 30443 (NodePort), udp port 443 (QUIC) — BPF limits volume.
# In-pod: destination is pod IP (after DNAT), so "dst host TARGET_IP" cannot be used; use port-only.
# Host/VM capture (when applicable): use "(tcp or udp) and port 443 and dst host $TARGET_IP" so only traffic to MetalLB IP is captured (gold standard). Post-capture: verify with tshark -Y "udp.port == 443 && ip.dst == $TARGET_IP" and stray -Y "udp.port == 443 && ip.dst != $TARGET_IP" (must be 0); SNI: tshark -Y "quic && tls.handshake.extensions_server_name contains record.local".
# CAPTURE_MAX_DURATION: max seconds tcpdump runs in-pod (timeout wrapper); avoids runaway size and OOM. Unset = no limit.
# In-pod apk/apt install capped at CAPTURE_INSTALL_TIMEOUT so we never hang. Quick mode (CAPTURE_STOP_TIMEOUT set) uses 55s; else up to 60s.
# To avoid install at runtime, bake tcpdump into Caddy/Envoy images (scripts/ensure-caddy-envoy-tcpdump.sh or k3d-registry-push-and-patch.sh).
# When host kills kubectl exec (SIGKILL), we log cleanly and do not treat as protocol failure (see stop_and_analyze_captures).
CAPTURE_INSTALL_TIMEOUT="${CAPTURE_INSTALL_TIMEOUT:-60}"
[[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] && CAPTURE_INSTALL_TIMEOUT="${CAPTURE_INSTALL_TIMEOUT:-55}"
CAPTURE_MAX_DURATION="${CAPTURE_MAX_DURATION:-}"
start_capture() {
  [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]] && return 0
  local ns="$1"
  local pod="$2"
  # Default: port-only (tcp/udp 443). MetalLB L2: traffic inside pod is DNAT'd — we see pod IP, not LB IP; host filter would show 0 packets.
  local filter="${3:-}"
  if [[ -z "$filter" ]]; then
    filter="tcp port 443 or udp port 443"
  fi
  local dir
  dir="$(packet_capture_dir)"
  mkdir -p "$dir"

  # Print traffic path once per session (which IP/port tests use: NodePort vs LB IP)
  if [[ -n "${CAPTURE_TRAFFIC_TARGET:-}" ]] && [[ -z "${_CAPTURE_PRINTED_TARGET:-}" ]]; then
    echo "  [packet-capture] Traffic target (HTTP/2 + HTTP/3): ${CAPTURE_TRAFFIC_TARGET}"
    _CAPTURE_PRINTED_TARGET=1
    export _CAPTURE_PRINTED_TARGET
  fi

  # Ensure tcpdump in pod. If already present (e.g. caddy-with-tcpdump image or ensure-tcpdump ran), skip install to avoid timeout.
  local _install_cap="${CAPTURE_INSTALL_TIMEOUT:-60}"
  [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] && [[ "$_install_cap" -gt 55 ]] && _install_cap=55
  local _need_install=1
  if ( KUBECTL_EXEC_TIMEOUT=5s _capture_kubectl -n "$ns" exec "$pod" -- which tcpdump >/dev/null 2>&1 ); then
    _need_install=0
    echo "  [packet-capture] tcpdump present in $ns/$pod (preinstalled in image or by ensure-tcpdump); skipping install"
  fi
  if [[ "$_need_install" -eq 1 ]]; then
    # Alpine or Debian: apk/apt install; cap wait so we don't hang.
    ( KUBECTL_EXEC_TIMEOUT="${_install_cap}s" _capture_kubectl -n "$ns" exec "$pod" -- sh -c '
      if ! command -v tcpdump >/dev/null 2>&1; then
        (apk add --no-cache tcpdump 2>/dev/null) || (apt-get update -qq && apt-get install -y tcpdump 2>/dev/null) || true
      fi
      command -v tcpdump
    ' >/dev/null 2>&1 ) &
    local install_pid=$!
    local waited=0
    while [[ $waited -lt "$_install_cap" ]] && kill -0 "$install_pid" 2>/dev/null; do sleep 2; waited=$((waited + 2)); done
    if kill -0 "$install_pid" 2>/dev/null; then
      kill -9 "$install_pid" 2>/dev/null || true
      echo "  [packet-capture] tcpdump install timed out (${_install_cap}s) on $pod; skipping capture (to preinstall: scripts/ensure-tcpdump-in-capture-pods.sh or k3d: scripts/k3d-registry-push-and-patch.sh)"
    fi
    wait "$install_pid" 2>/dev/null || true
  fi

  # Run tcpdump in foreground inside pod; keep kubectl exec alive on host.
  # Elite: -i eth0 so only ingress to pod (Caddy/Envoy); no background cluster traffic. Fallback: -i any if eth0 missing.
  # -nn -s 0 -B 8192: no DNS resolution, full packet, buffer 8K so we see TCP/UDP 443 in pod.
  # Optional CAPTURE_MAX_DURATION: run "timeout N tcpdump ..." in-pod so tcpdump self-exits (avoids runaway size/OOM).
  # When host sends SIGKILL we log in stop_and_analyze_captures and do not treat as protocol failure.
  local name="${pod//[^a-zA-Z0-9_-]/_}"
  local logfile="$dir/capture-$name.log"
  # Log interfaces before starting tcpdump (diagnostic when capture shows 0 packets — confirms which interface has traffic)
  _capture_kubectl -n "$ns" exec "$pod" -- sh -c "echo \"=== $ns/$pod interfaces ===\"; ip addr 2>/dev/null || ifconfig 2>/dev/null || true" >> "$logfile" 2>&1 || true
  local base_cmd="tcpdump -i eth0 -nn -s 0 -B 8192 -U -w /tmp/capture-$name.pcap $filter 2>&1"
  local run_cmd="$base_cmd"
  if [[ -n "${CAPTURE_MAX_DURATION:-}" ]] && [[ "${CAPTURE_MAX_DURATION:-0}" -gt 0 ]]; then
    run_cmd="timeout ${CAPTURE_MAX_DURATION}s $base_cmd || $base_cmd"
  fi
  if _capture_kubectl -n "$ns" exec "$pod" -- which tcpdump >/dev/null 2>&1; then
    _capture_kubectl -n "$ns" exec "$pod" -- sh -c "$run_cmd" >> "$logfile" 2>&1 &
    local capture_pid=$!
    _CAPTURE_PIDS+=($capture_pid)
    _CAPTURE_PODS+=("$pod")
    _CAPTURE_NS+=("$ns")
    # Warmup: tcpdump needs ~1–2s to attach; wait before first test to avoid "no TCP/UDP 443" (race). For QUIC/HTTP/3 set CAPTURE_WARMUP_SECONDS=3 or 4 so first UDP 443 packets are captured.
    # Default 3s (was 2s); Colima/rotation default 4s (set in caller).
    local warmup="${CAPTURE_WARMUP_SECONDS:-3}"
    sleep "$warmup"
    # PID check: ensure kubectl exec is still running (not killed by API server timeout)
    if ! kill -0 "$capture_pid" 2>/dev/null; then
      echo "  [packet-capture] ⚠️  kubectl exec tcpdump PID $capture_pid exited early (API server timeout or pod restart); capture may be incomplete"
    fi
  fi
}

# Drain time (seconds) before stopping tcpdump so in-flight QUIC/HTTP/3 packets are captured.
# Default 3s so analysis sees TCP/UDP 443; set 0 to skip. FAST_CAPTURE=1 forces 0. When CAPTURE_STOP_TIMEOUT is set we use min 2s unless FAST_CAPTURE=1.
CAPTURE_DRAIN_SECONDS="${CAPTURE_DRAIN_SECONDS:-5}"
[[ "${FAST_CAPTURE:-0}" == "1" ]] && CAPTURE_DRAIN_SECONDS=0
# Optional: copy pcaps to this host dir after stop (for tshark analysis). Same pattern as rotation-suite.
CAPTURE_COPY_DIR="${CAPTURE_COPY_DIR:-}"
# Timeout (seconds) for each pcap copy (kubectl exec cat). Prevents hang; script also has CAPTURE_STOP_TIMEOUT for whole stop phase.
CAPTURE_COPY_TIMEOUT="${CAPTURE_COPY_TIMEOUT:-10}"

# Quick "first packet" analyze: first pod only, bounded time. When CAPTURE_STOP_TIMEOUT is set use short timeout so we don't stick.
QUICK_FIRST_PACKET_TIMEOUT="${QUICK_FIRST_PACKET_TIMEOUT:-3}"
QUICK_FIRST_PACKET_COUNT="${QUICK_FIRST_PACKET_COUNT:-10}"
_quick_first_packet_analyze() {
  [[ ${#_CAPTURE_PODS[@]} -eq 0 ]] && return 0
  local pod="${_CAPTURE_PODS[0]}"
  local ns="${_CAPTURE_NS[0]}"
  local name="${pod//[^a-zA-Z0-9_-]/_}"
  local timeout="${QUICK_FIRST_PACKET_TIMEOUT:-3}"
  [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] && timeout=2
  local count="${QUICK_FIRST_PACKET_COUNT:-10}"
  echo "  [packet-capture] First packets (${ns}/${pod}, max ${count}, ${timeout}s)…"
  [[ -n "${CAPTURE_TRAFFIC_TARGET:-}" ]] && echo "  [packet-capture] Traffic target: ${CAPTURE_TRAFFIC_TARGET}"
  local _qout
  _qout=$(mktemp 2>/dev/null || echo "/tmp/pcap-first-$$.out")
  # Use short kubectl timeout so first-packet read never sticks (3s when stop timeout set)
  local _kctl_timeout="${KUBECTL_EXEC_TIMEOUT:-15s}"
  [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] && _kctl_timeout="3s"
  ( KUBECTL_EXEC_TIMEOUT="$_kctl_timeout" _capture_kubectl -n "$ns" exec "$pod" -- sh -c "
    echo \"=== $ns/$pod (first ${count} packets) ===\"
    tcpdump -r /tmp/capture-$name.pcap -c $count -n 2>/dev/null || echo '(no packets or missing pcap)'
    echo -n 'TCP 443: '; tcpdump -r /tmp/capture-$name.pcap -n 'tcp port 443' 2>/dev/null | wc -l
    echo -n 'UDP 443: '; tcpdump -r /tmp/capture-$name.pcap -n 'udp port 443' 2>/dev/null | wc -l
  " 2>/dev/null ) > "$_qout" &
  local qpid=$!
  local qwaited=0
  while [[ $qwaited -lt $timeout ]] && kill -0 "$qpid" 2>/dev/null; do sleep 1; qwaited=$((qwaited + 1)); done
  if kill -0 "$qpid" 2>/dev/null; then
    kill -9 "$qpid" 2>/dev/null || true
    echo "  [packet-capture] First-packet view timed out after ${timeout}s"
  fi
  # Avoid blocking forever on wait (e.g. stuck kubectl child): wait in background, then cap wait time
  wait "$qpid" 2>/dev/null &
  local _wpid=$!
  local _w=0
  while [[ $_w -lt 3 ]] && kill -0 "$_wpid" 2>/dev/null; do sleep 1; _w=$((_w + 1)); done
  kill "$_wpid" 2>/dev/null || true
  wait "$_wpid" 2>/dev/null || true
  if [[ -f "$_qout" ]] && [[ -s "$_qout" ]]; then
    cat "$_qout"
  else
    echo "  [packet-capture] (first-packet output empty — pcap may be empty or kubectl timed out)"
  fi
  rm -f "$_qout"
}

# Max wall-clock seconds for the whole stop phase (drain + kill + copy + analyze). Prevents runaway when run without CAPTURE_STOP_TIMEOUT.
CAPTURE_MAX_STOP_SECONDS="${CAPTURE_MAX_STOP_SECONDS:-75}"

# Hard timeout for in-pod tcpdump stop (SIGINT then wait then SIGKILL). Never wait unbounded.
CAPTURE_INPOD_STOP_TIMEOUT="${CAPTURE_INPOD_STOP_TIMEOUT:-8}"
# Hard timeout for host-side kubectl exec (capture) processes to exit after in-pod tcpdump is killed.
CAPTURE_HOST_WAIT_TIMEOUT="${CAPTURE_HOST_WAIT_TIMEOUT:-5}"

# Stop all started captures and optionally analyze.
# Colima-safe: we never wait unbounded. We stop tcpdump inside the pod first (SIGINT, 5s wait, SIGKILL), then kill host PIDs with timeout.
# Usage: stop_and_analyze_captures [1=analyze]
# DISABLE_PACKET_CAPTURE=1: no-op. FAST_CAPTURE=1: no drain, no first-packet analysis; quick in-pod kill then proceed.
stop_and_analyze_captures() {
  local do_analyze="${1:-1}"
  local i
  local dir
  dir="$(packet_capture_dir)"
  local drain_s="${CAPTURE_DRAIN_SECONDS:-0}"
  local copy_dir="${CAPTURE_COPY_DIR:-}"
  local _stop_start
  _stop_start=$(date +%s 2>/dev/null || echo "0")
  _capture_elapsed() { echo $(($(date +%s 2>/dev/null || echo "0") - _stop_start)); }

  if [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]]; then
    _CAPTURE_PIDS=()
    _CAPTURE_PODS=()
    _CAPTURE_NS=()
    return 0
  fi

  # Drain: allow in-flight QUIC/HTTP/3 packets. FAST_CAPTURE=1 forces 0; CAPTURE_STOP_TIMEOUT no longer forces 2s so suite always proceeds.
  local actual_drain="${drain_s}"
  if [[ "${FAST_CAPTURE:-0}" == "1" ]]; then
    actual_drain=0
  fi
  if [[ "$actual_drain" -gt 0 ]]; then
    [[ "$actual_drain" -gt 5 ]] && actual_drain=5
    echo "  [packet-capture] Drain ${actual_drain}s for in-flight packets…"
    sleep "$actual_drain"
  fi

  # 1) Stop tcpdump inside each pod (so kubectl exec sessions get EOF and exit). Never block: use timeout per pod.
  local inpod_to="${CAPTURE_INPOD_STOP_TIMEOUT:-8}"
  for (( i=0; i<${#_CAPTURE_PODS[@]}; i++ )); do
    local pod="${_CAPTURE_PODS[$i]}"
    local ns="${_CAPTURE_NS[$i]}"
    [[ -z "$pod" ]] && continue
    timeout "$inpod_to" kubectl --request-timeout="$KUBECTL_EXEC_TIMEOUT" -n "$ns" exec "$pod" -- sh -c "pkill -INT tcpdump 2>/dev/null; for _i in 1 2 3 4 5 6 7 8 9 10; do pgrep tcpdump >/dev/null 2>&1 || exit 0; sleep 0.5; done; pkill -9 tcpdump 2>/dev/null" >/dev/null 2>&1 || true
  done

  # 2) Wait bounded time for host-side kubectl exec (capture) PIDs to exit, then force kill. Never wait unbounded.
  local host_to="${CAPTURE_HOST_WAIT_TIMEOUT:-5}"
  local w=0
  while [[ $w -lt $host_to ]]; do
    local any=0
    for (( i=0; i<${#_CAPTURE_PIDS[@]}; i++ )); do
      kill -0 "${_CAPTURE_PIDS[$i]}" 2>/dev/null && any=1 && break
    done
    [[ "$any" -eq 0 ]] && break
    sleep 1
    w=$((w+1))
  done
  for (( i=0; i<${#_CAPTURE_PIDS[@]}; i++ )); do
    local pid="${_CAPTURE_PIDS[$i]}"
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done
  echo "  [packet-capture] Capture stopped (in-pod SIGINT/SIGKILL + host timeout ${host_to}s; non-blocking)."
  sleep "${CAPTURE_POST_STOP_SLEEP:-0}"

  # 3) First-packet analysis: skip when FAST_CAPTURE=1 or CAPTURE_STOP_TIMEOUT; otherwise run with hard timeout so we never block.
  if [[ ${#_CAPTURE_PODS[@]} -gt 0 ]] && [[ "${FAST_CAPTURE:-0}" != "1" ]] && [[ -z "${CAPTURE_STOP_TIMEOUT:-}" ]]; then
    local _analyze_to="${CAPTURE_ANALYZE_TIMEOUT:-10}"
    ( _quick_first_packet_analyze ) &
    local _analyze_pid=$!
    local _waited=0
    while [[ $_waited -lt $_analyze_to ]] && kill -0 "$_analyze_pid" 2>/dev/null; do sleep 1; _waited=$((_waited+1)); done
    kill -9 "$_analyze_pid" 2>/dev/null || true
    wait "$_analyze_pid" 2>/dev/null || true
  fi

  # When CAPTURE_STOP_TIMEOUT or FAST_CAPTURE: quick in-pod TCP/UDP 443 count so caller sees "TCP 443: N" (avoids "no TCP/UDP 443 counts" warning), then clear state.
  # Run synchronously so stdout is captured by caller (e.g. baseline's _cap_summary); with MetalLB, traffic is to LB IP so filter by port 443.
  if [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] || [[ "${FAST_CAPTURE:-0}" == "1" ]]; then
    if [[ ${#_CAPTURE_PODS[@]} -gt 0 ]] && [[ "$do_analyze" == "1" ]]; then
      local _quick_to=5
      for (( i=0; i<${#_CAPTURE_PODS[@]}; i++ )); do
        local pod="${_CAPTURE_PODS[$i]}"
        local ns="${_CAPTURE_NS[$i]}"
        local name="${pod//[^a-zA-Z0-9_-]/_}"
        local _tcp_p=443 _udp_p=443
        [[ "$ns" == "envoy-test" ]] || [[ "$pod" == *"envoy"* ]] && { _tcp_p=10000; _udp_p=10000; }
        KUBECTL_EXEC_TIMEOUT="${_quick_to}s" _capture_kubectl -n "$ns" exec "$pod" -- sh -c "
          if [ -f /tmp/capture-$name.pcap ]; then
            echo \"=== $ns/$pod ===\"
            echo -n 'TCP ${_tcp_p}: '; tcpdump -r /tmp/capture-$name.pcap -n 'tcp port ${_tcp_p}' 2>/dev/null | wc -l
            echo -n 'UDP ${_udp_p}: '; tcpdump -r /tmp/capture-$name.pcap -n 'udp port ${_udp_p}' 2>/dev/null | wc -l
            echo -n '10000: '; tcpdump -r /tmp/capture-$name.pcap -n 'port 10000' 2>/dev/null | wc -l
          fi
        " 2>/dev/null || true
      done
    fi
    CAPTURE_DRAIN_SECONDS=0
    CAPTURE_COPY_DIR=""
    _CAPTURE_PIDS=()
    _CAPTURE_PODS=()
    _CAPTURE_NS=()
    return 0
  fi

  # Copy pcaps to host (same pattern as rotation-suite) so tshark can analyze HTTP/2 and HTTP/3/QUIC
  copy_dir_used="${copy_dir:-$dir}"
  if [[ ${#_CAPTURE_PODS[@]} -gt 0 ]] && [[ -n "$copy_dir_used" ]]; then
    local _max_stop="${CAPTURE_MAX_STOP_SECONDS:-75}"
    if [[ $(_capture_elapsed) -ge "$_max_stop" ]]; then
      echo "  [packet-capture] Stop phase already at ${_max_stop}s; skipping pcap copy (set CAPTURE_MAX_STOP_SECONDS to increase)"
    else
    echo "  [packet-capture] Copying pcaps from ${#_CAPTURE_PODS[@]} pod(s) (${CAPTURE_COPY_TIMEOUT:-10}s per pod, max ${_max_stop}s total)…"
    mkdir -p "$copy_dir_used"
    for (( i=0; i<${#_CAPTURE_PODS[@]}; i++ )); do
      [[ $(_capture_elapsed) -ge "$_max_stop" ]] && echo "  [packet-capture] Hit ${_max_stop}s limit; skipping remaining pods" && break
      local pod="${_CAPTURE_PODS[$i]}"
      local ns="${_CAPTURE_NS[$i]}"
      local name="${pod//[^a-zA-Z0-9_-]/_}"
      local dest="$copy_dir_used/capture-$name.pcap"
      echo "  [packet-capture] Pod $((i+1))/${#_CAPTURE_PODS[@]}: $pod …"
      # In-pod size before copy (diagnostic when pcaps are empty). Skip when CAPTURE_STOP_TIMEOUT set to avoid blocking.
      local in_size="0"
      if [[ -z "${CAPTURE_STOP_TIMEOUT:-}" ]]; then
        in_size=$(_capture_kubectl -n "$ns" exec "$pod" -- sh -c "wc -c < /tmp/capture-$name.pcap 2>/dev/null || echo 0" 2>/dev/null | tr -d '[:space:]' || echo "0")
      fi
      # Copy with timeout so we don't hang (large pcaps or slow API); default 10s per pod
      local copy_timeout="${CAPTURE_COPY_TIMEOUT:-10}"
      ( _capture_kubectl -n "$ns" exec "$pod" -- sh -c "sync 2>/dev/null; cat /tmp/capture-$name.pcap" > "$dest" 2>/dev/null ) &
      local copy_pid=$!
      local waited=0
      while [[ $waited -lt $copy_timeout ]] && kill -0 "$copy_pid" 2>/dev/null; do sleep 2; waited=$((waited + 2)); done
      kill -9 "$copy_pid" 2>/dev/null || true
      wait "$copy_pid" 2>/dev/null || true
      local out_size=0
      [[ -f "$dest" ]] && out_size=$(wc -c < "$dest" 2>/dev/null | tr -d '[:space:]' || echo "0")
      # Retry copy once if in-pod had data but host got 0 (e.g. stream truncation or flush delay)
      if [[ "${in_size:-0}" -gt 0 ]] && [[ "${out_size:-0}" -eq 0 ]]; then
        sleep 1
        ( _capture_kubectl -n "$ns" exec "$pod" -- sh -c "sync 2>/dev/null; cat /tmp/capture-$name.pcap" > "$dest" 2>/dev/null ) &
        copy_pid=$!
        waited=0
        while [[ $waited -lt $copy_timeout ]] && kill -0 "$copy_pid" 2>/dev/null; do sleep 2; waited=$((waited + 2)); done
        kill -9 "$copy_pid" 2>/dev/null || true
        wait "$copy_pid" 2>/dev/null || true
        out_size=0
        [[ -f "$dest" ]] && out_size=$(wc -c < "$dest" 2>/dev/null | tr -d '[:space:]' || echo "0")
      fi
      echo "  [packet-capture] $pod: in-pod ${in_size:-0} bytes, copied ${out_size:-0} bytes"
    done
    # tshark protocol verification (HTTP/2 and QUIC) when available
    _lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
    if [[ -z "$_lib_dir" ]]; then
      [[ -n "${SCRIPT_DIR:-}" ]] && _lib_dir="${SCRIPT_DIR}/lib"
    fi
    if [[ -n "$_lib_dir" ]] && [[ -f "$_lib_dir/protocol-verification.sh" ]]; then
      # shellcheck source=scripts/lib/protocol-verification.sh
      source "$_lib_dir/protocol-verification.sh"
    fi
    if command -v tshark >/dev/null 2>&1 && type verify_protocol_in_dir &>/dev/null 2>&1; then
      echo "  [packet-capture] Verifying protocols (tshark) in $copy_dir_used"
      verify_protocol_in_dir "$copy_dir_used" "capture" || true
    fi
    fi
  fi

  # Reset for next run (callers may set again)
  CAPTURE_DRAIN_SECONDS=0
  CAPTURE_COPY_DIR=""

  if [[ "$do_analyze" == "1" ]]; then
    if [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]]; then
      echo "  [packet-capture] Skipping in-pod analyze (timeout set); copy above is sufficient for tshark on host"
    elif [[ $(_capture_elapsed) -ge "${CAPTURE_MAX_STOP_SECONDS:-75}" ]]; then
      echo "  [packet-capture] Skipping in-pod analyze (hit ${CAPTURE_MAX_STOP_SECONDS:-75}s limit)"
    else
      echo "  [packet-capture] Analyzing…"
      analyze_captures
    fi
  fi

  _CAPTURE_PIDS=()
  _CAPTURE_PODS=()
  _CAPTURE_NS=()
}

# Analyze captures (call after stop). Reads from pods, prints summary.
# Each pod's kubectl exec is run with a hard timeout (ANALYZE_POD_TIMEOUT) so we never hang.
ANALYZE_POD_TIMEOUT="${CAPTURE_ANALYZE_TIMEOUT:-15}"
analyze_captures() {
  local i
  local dir
  dir="$(packet_capture_dir)"

  for (( i=0; i<${#_CAPTURE_PODS[@]}; i++ )); do
    local pod="${_CAPTURE_PODS[$i]}"
    local ns="${_CAPTURE_NS[$i]}"
    local name="${pod//[^a-zA-Z0-9_-]/_}"

    (
      # Envoy listens on 10000 (h2c); Caddy on 443. Use correct port per pod for meaningful counts.
      local tcp_port="443" udp_port="443"
      [[ "$ns" == "envoy-test" ]] || [[ "$pod" == *"envoy"* ]] && { tcp_port="10000"; udp_port="10000"; }
      _capture_kubectl -n "$ns" exec "$pod" -- sh -c "
        if [ -f /tmp/capture-$name.pcap ]; then
          echo \"=== $ns/$pod ===\"
          echo -n 'TCP ${tcp_port}: '; tcpdump -r /tmp/capture-$name.pcap -n 'tcp port ${tcp_port}' 2>/dev/null | wc -l
          echo -n 'UDP ${udp_port}: '; tcpdump -r /tmp/capture-$name.pcap -n 'udp port ${udp_port}' 2>/dev/null | wc -l
          echo -n '30443: '; tcpdump -r /tmp/capture-$name.pcap -n 'port 30443' 2>/dev/null | wc -l
          echo -n '10000: '; tcpdump -r /tmp/capture-$name.pcap -n 'port 10000' 2>/dev/null | wc -l
          echo -n 'TCP (any): '; tcpdump -r /tmp/capture-$name.pcap -n 'tcp' 2>/dev/null | wc -l
          echo -n 'UDP (any): '; tcpdump -r /tmp/capture-$name.pcap -n 'udp' 2>/dev/null | wc -l
          tcpdump -r /tmp/capture-$name.pcap -c 3 -n 2>/dev/null || true
          rm -f /tmp/capture-$name.pcap
        fi
      " 2>/dev/null || true
    ) &
    local anal_pid=$!
    local anal_waited=0
    while [[ $anal_waited -lt ${ANALYZE_POD_TIMEOUT} ]] && kill -0 "$anal_pid" 2>/dev/null; do sleep 1; anal_waited=$((anal_waited + 1)); done
    if kill -0 "$anal_pid" 2>/dev/null; then
      kill -9 "$anal_pid" 2>/dev/null || true
      echo "  [packet-capture] $pod: analyze timed out after ${ANALYZE_POD_TIMEOUT}s"
    fi
    wait "$anal_pid" 2>/dev/null || true
  done
}

# Initialize capture session (set dir, clear state). Call at start of each run so capture is clear and not mixed with a previous run.
init_capture_session() {
  _CAPTURE_DIR="/tmp/packet-captures-$(date +%s)-$$"
  _CAPTURE_PIDS=()
  _CAPTURE_PODS=()
  _CAPTURE_NS=()
  mkdir -p "$_CAPTURE_DIR"
}

# Optional: verify protocol counts from analyze output (passed via stdin or file).
# Usage: analyze_captures 2>&1 | tee /tmp/analysis.log; verify_protocol_counts /tmp/analysis.log
# Expects lines like "TCP 443: N", "UDP 443: M", "30443: N", "TCP (any): N". Sums across all pods.
# Accepts 30443 as TCP fallback; accepts "TCP (any) > 0" as soft pass when 443 not seen (e.g. Colima/NodePort).
verify_protocol_counts() {
  local input="${1:-/dev/stdin}"
  local tcp=0 udp=0 tcp_any=0 udp_any=0 envoy_10000=0 n
  while IFS= read -r line; do
    if [[ "$line" =~ TCP\ 443:\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      tcp=$((tcp + n))
    elif [[ "$line" =~ UDP\ 443:\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      udp=$((udp + n))
    elif [[ "$line" =~ 30443:\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      tcp=$((tcp + n))
    elif [[ "$line" =~ 10000:\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      envoy_10000=$((envoy_10000 + n))
    elif [[ "$line" =~ TCP\ 10000:\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      envoy_10000=$((envoy_10000 + n))
    elif [[ "$line" =~ TCP\ \(any\):\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      tcp_any=$((tcp_any + n))
    elif [[ "$line" =~ UDP\ \(any\):\ *([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      udp_any=$((udp_any + n))
    fi
  done < <(grep -E "TCP 443:|UDP 443:|30443:|10000:|TCP 10000:|TCP \(any\)|UDP \(any\)" "$input" 2>/dev/null || true)
  if [[ "${tcp:-0}" -gt 0 ]] && [[ "${udp:-0}" -gt 0 ]]; then
    echo "Protocol comparison: TCP 443=$tcp, UDP 443=$udp (both present across pods)"
    return 0
  fi
  if [[ "${tcp:-0}" -gt 0 ]]; then
    echo "Protocol comparison: TCP 443=$tcp, UDP 443=${udp:-0} (UDP/QUIC not detected; TCP present)"
    return 0
  fi
  if [[ "${envoy_10000:-0}" -gt 0 ]]; then
    echo "Protocol comparison: Envoy port 10000=$envoy_10000 (gRPC traffic reached Envoy)"
    return 0
  fi
  if [[ "${tcp_any:-0}" -gt 0 ]] || [[ "${udp_any:-0}" -gt 0 ]]; then
    echo "Protocol comparison: TCP 443=${tcp:-0}, UDP 443=${udp:-0} (TCP (any)=$tcp_any, UDP (any)=$udp_any; traffic captured, 443 may not be visible on this path)"
    return 0
  fi
  echo "Protocol comparison: TCP 443=${tcp:-0}, UDP 443=${udp:-0}, Envoy 10000=${envoy_10000:-0} (expected Caddy 443 or Envoy 10000 > 0)"
  return 1
}
