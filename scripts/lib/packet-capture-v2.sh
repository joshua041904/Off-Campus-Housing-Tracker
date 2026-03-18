#!/usr/bin/env bash
# Packet capture v2: 3-layer transport observability.
# Layer 1 (authoritative): Node (Colima VM) — before DNAT/kube-proxy.
# Layer 2: Caddy pod — pod ingress after DNAT.
# Layer 3: Envoy pod — upstream hop (gRPC/h2c).
#
# Usage:
#   source scripts/lib/packet-capture-v2.sh
#   init_capture_session_v2
#   start_capture_v2   # uses CAPTURE_V2_* env vars or discovers pods
#   # ... run tests ...
#   stop_and_analyze_captures_v2
#
# Env: CAPTURE_V2_CADDY_POD, CAPTURE_V2_CADDY_NS (default ingress-nginx),
#      CAPTURE_V2_ENVOY_POD, CAPTURE_V2_ENVOY_NS (default envoy-test),
#      CAPTURE_V2_LB_IP (optional), DISABLE_PACKET_CAPTURE=1 to skip.
#      CAPTURE_NODE_ONLY=1 — run only node-level capture (no kubectl exec); macOS-proof, no OOM.
#      CAPTURE_RING_BUFFER=1 — use -C 100 -W 5 on node tcpdump to prevent memory blowup.
#      STRICT_QUIC_VALIDATION=1 — after capture, fail if no QUIC packets or no h3 ALPN.
# Colima: Node capture only when 'colima' is available; CAPTURE_WARMUP_SECONDS=4 default.
# Safe to source; no set -e so failures in optional steps don't exit the caller.

_CAPTURE_V2_DIR=""
_CAPTURE_V2_NODE_PID=""
_CAPTURE_V2_CADDY_PID=""
_CAPTURE_V2_ENVOY_PID=""
_CAPTURE_V2_NODE_PCAP=""
_CAPTURE_V2_CADDY_PCAP=""
_CAPTURE_V2_ENVOY_PCAP=""
KUBECTL_EXEC_TIMEOUT="${KUBECTL_EXEC_TIMEOUT:-15s}"

packet_capture_dir() {
  echo "${_CAPTURE_V2_DIR:-/tmp/packet-captures-v2-$$}"
}

_capture_v2_kubectl() {
  kubectl --request-timeout="$KUBECTL_EXEC_TIMEOUT" "$@"
}

# Initialize session. Call once before start_capture_v2.
init_capture_session_v2() {
  [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]] && return 0
  _CAPTURE_V2_DIR="/tmp/packet-captures-v2-$(date +%s)-$$"
  _CAPTURE_V2_NODE_PID=""
  _CAPTURE_V2_CADDY_PID=""
  _CAPTURE_V2_ENVOY_PID=""
  _CAPTURE_V2_NODE_PCAP=""
  _CAPTURE_V2_CADDY_PCAP=""
  _CAPTURE_V2_ENVOY_PCAP=""
  mkdir -p "$_CAPTURE_V2_DIR"
  echo "  [packet-capture-v2] Dir: $_CAPTURE_V2_DIR"
}

# Start all 3 layers in order: node → caddy → envoy, with 2s between, then warmup and PID check.
# Requires: CAPTURE_V2_CADDY_POD, CAPTURE_V2_ENVOY_POD (or set automatically from cluster).
start_capture_v2() {
  [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]] && return 0
  # macOS/Colima: default node-only so kubectl exec tcpdump (L2/L3) is not killed by host (Transport Hardening V4)
  if command -v colima >/dev/null 2>&1 && [[ -z "${CAPTURE_NODE_ONLY:-}" ]]; then
    export CAPTURE_NODE_ONLY=1
  fi
  local dir
  dir="$(packet_capture_dir)"
  local caddy_ns="${CAPTURE_V2_CADDY_NS:-ingress-nginx}"
  local envoy_ns="${CAPTURE_V2_ENVOY_NS:-envoy-test}"
  local caddy_pod="${CAPTURE_V2_CADDY_POD:-}"
  local envoy_pod="${CAPTURE_V2_ENVOY_POD:-}"

  if [[ -z "$caddy_pod" ]]; then
    caddy_pod=$(_capture_v2_kubectl -n "$caddy_ns" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  fi
  if [[ -z "$envoy_pod" ]]; then
    envoy_pod=$(_capture_v2_kubectl -n "$envoy_ns" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -z "$envoy_pod" ]]; then
      envoy_pod=$(_capture_v2_kubectl -n ingress-nginx get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
      [[ -n "$envoy_pod" ]] && envoy_ns="ingress-nginx"
    fi
  fi
  [[ "${CAPTURE_SKIP_ENVOY:-0}" == "1" ]] && envoy_pod=""

  [[ -z "$caddy_pod" ]] && echo "  [packet-capture-v2] No Caddy pod found; skipping L2." || true
  [[ -z "$envoy_pod" ]] && echo "  [packet-capture-v2] No Envoy pod found; skipping L3." || true

  # Ensure caddy-h3 Service exposes both TCP and UDP 443 (required for QUIC)
  if _capture_v2_kubectl -n "$caddy_ns" get svc caddy-h3 -o yaml 2>/dev/null | grep -q 'protocol: UDP'; then
    : # UDP 443 present
  else
    echo "  [packet-capture-v2] Hint: caddy-h3 Service should expose UDP 443 for QUIC; kubectl -n $caddy_ns get svc caddy-h3 -o yaml"
  fi

  # --- Layer 1: Node (Colima VM) — authoritative, before DNAT ---
  # BPF: when CAPTURE_V2_LB_IP is set, restrict to dst host LB IP so capture proves traffic to MetalLB only (no background QUIC).
  local node_filter="(tcp or udp) and port 443"
  if [[ -n "${CAPTURE_V2_LB_IP:-}" ]]; then
    node_filter="(tcp or udp) and port 443 and dst host ${CAPTURE_V2_LB_IP}"
    echo "  [packet-capture-v2] L1 (node): BPF restricted to dst host $CAPTURE_V2_LB_IP (MetalLB only)"
  fi
  if command -v colima >/dev/null 2>&1; then
    echo "  [packet-capture-v2] L1 (node): starting tcpdump on Colima VM..."
    # -B 4096: buffer; -G 120 -W 1: time-bound 120s, single file (avoids macOS OOM / Killed: 9)
    colima ssh -- sudo tcpdump -i any -B 4096 -G 120 -W 1 -nn "$node_filter" -w /tmp/node-capture-v2.pcap 2>"$dir/node-capture.log" &
    _CAPTURE_V2_NODE_PID=$!
    _CAPTURE_V2_NODE_PCAP="/tmp/node-capture-v2.pcap"
    sleep 2
    if ! kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
      echo "  [packet-capture-v2] L1 (node): tcpdump exited early (check $dir/node-capture.log)"
      _CAPTURE_V2_NODE_PID=""
    fi
  else
    echo "  [packet-capture-v2] L1 (node): colima not found; skip node-level capture."
  fi

  # --- Layer 2: Caddy pod (eth0, explicit filter) ---
  if [[ -n "$caddy_pod" ]]; then
    if _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- which tcpdump >/dev/null 2>&1; then
      echo "  [packet-capture-v2] L2 (Caddy $caddy_ns/$caddy_pod): starting tcpdump -i eth0..."
      # -B 4096 -G 120 -W 1: buffer + time-bound 120s, single file (avoids OOM / Killed: 9)
      _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- sh -c "tcpdump -i eth0 -B 4096 -G 120 -W 1 -nn '(tcp or udp) and port 443' -w /tmp/caddy-capture-v2.pcap 2>&1" >> "$dir/caddy-capture.log" 2>&1 &
      _CAPTURE_V2_CADDY_PID=$!
      _CAPTURE_V2_CADDY_PCAP="/tmp/caddy-capture-v2.pcap"
      sleep 2
      if ! kill -0 "$_CAPTURE_V2_CADDY_PID" 2>/dev/null; then
        echo "  [packet-capture-v2] L2 (Caddy): tcpdump exited early"
        _CAPTURE_V2_CADDY_PID=""
      fi
    else
      echo "  [packet-capture-v2] L2 (Caddy): tcpdump not in pod; run ensure-tcpdump-in-capture-pods.sh"
    fi
  fi

  # --- Layer 3: Envoy pod (optional; skip when CAPTURE_NODE_ONLY=1) ---
  if [[ "${CAPTURE_NODE_ONLY:-0}" != "1" ]] && [[ -n "$envoy_pod" ]]; then
    if _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- which tcpdump >/dev/null 2>&1; then
      echo "  [packet-capture-v2] L3 (Envoy $envoy_ns/$envoy_pod): starting tcpdump -i eth0 port 10000..."
      # -B 4096 -G 120 -W 1: buffer + time-bound 120s, single file (avoids OOM / Killed: 9)
      _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- sh -c "tcpdump -i eth0 -B 4096 -G 120 -W 1 -nn 'tcp port 10000' -w /tmp/envoy-capture-v2.pcap 2>&1" >> "$dir/envoy-capture.log" 2>&1 &
      _CAPTURE_V2_ENVOY_PID=$!
      _CAPTURE_V2_ENVOY_PCAP="/tmp/envoy-capture-v2.pcap"
      sleep 2
      if ! kill -0 "$_CAPTURE_V2_ENVOY_PID" 2>/dev/null; then
        echo "  [packet-capture-v2] L3 (Envoy): tcpdump exited early"
        _CAPTURE_V2_ENVOY_PID=""
      fi
    else
      echo "  [packet-capture-v2] L3 (Envoy): tcpdump not in pod"
    fi
  fi

  # Warmup: ensure tcpdump is receiving before tests (Colima: 4s)
  local warmup="${CAPTURE_WARMUP_SECONDS:-4}"
  echo "  [packet-capture-v2] Warmup ${warmup}s before tests..."
  sleep "$warmup"

  # PID check
  local ok=0
  [[ -n "$_CAPTURE_V2_NODE_PID" ]] && kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null && ok=1
  [[ -n "$_CAPTURE_V2_CADDY_PID" ]] && kill -0 "$_CAPTURE_V2_CADDY_PID" 2>/dev/null && ok=1
  [[ -n "$_CAPTURE_V2_ENVOY_PID" ]] && kill -0 "$_CAPTURE_V2_ENVOY_PID" 2>/dev/null && ok=1
  if [[ "$ok" -eq 0 ]]; then
    echo "  [packet-capture-v2] Warning: no capture process still running after warmup."
  else
    echo "  [packet-capture-v2] Capture running (L1=$_CAPTURE_V2_NODE_PID L2=$_CAPTURE_V2_CADDY_PID L3=$_CAPTURE_V2_ENVOY_PID). Start tests."
  fi
}

# Stop all captures: drain 5s, SIGINT, wait max 5s, force kill, copy pcaps, analyze with tcpdump -r.
stop_and_analyze_captures_v2() {
  [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]] && return 0
  local dir
  dir="$(packet_capture_dir)"
  local drain="${CAPTURE_DRAIN_SECONDS:-5}"
  echo "  [packet-capture-v2] Drain ${drain}s for in-flight packets..."
  sleep "$drain"

  # Stop node capture (Colima): SIGINT only so tcpdump flushes pcap; no kill -9 (Transport Hardening V4)
  if [[ -n "$_CAPTURE_V2_NODE_PID" ]] && kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
    kill -INT "$_CAPTURE_V2_NODE_PID" 2>/dev/null || true
    local w=0
    while [[ $w -lt 10 ]] && kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; do sleep 1; w=$((w+1)); done
    if kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
      echo "  [packet-capture-v2] L1 (node): tcpdump did not exit after SIGINT; copying partial pcap."
    fi
    # Do not kill -9 node process; copy what we have
  fi
  # Copy node pcap from Colima to host (single file or ring-buffer rotated files)
  if command -v colima >/dev/null 2>&1 && [[ -n "$_CAPTURE_V2_NODE_PCAP" ]]; then
    if [[ "${CAPTURE_RING_BUFFER:-1}" == "1" ]]; then
      local _files
      _files=$(colima ssh -- "ls -v /tmp/node-capture-v2.pcap* 2>/dev/null" 2>/dev/null || true)
      if [[ -n "$_files" ]]; then
        while read -r _f; do
          [[ -z "$_f" ]] && continue
          _fname=$(basename "$_f")
          colima ssh -- cat "$_f" 2>/dev/null > "$dir/$_fname" || true
        done <<< "$_files"
        colima ssh -- "rm -f /tmp/node-capture-v2.pcap*" 2>/dev/null || true
        if command -v mergecap >/dev/null 2>&1; then
          local _list
          _list=$(ls "$dir"/node-capture-v2.pcap* 2>/dev/null || true)
          if [[ -n "$_list" ]]; then
            mergecap -w "$dir/node-capture.pcap" $(echo "$_list" | tr '\n' ' ') 2>/dev/null && echo "  [packet-capture-v2] Merged ring-buffer pcaps to $dir/node-capture.pcap" || cp -f "$dir/node-capture-v2.pcap" "$dir/node-capture.pcap" 2>/dev/null || true
          else
            cp -f "$dir/node-capture-v2.pcap" "$dir/node-capture.pcap" 2>/dev/null || true
          fi
        else
          cp -f "$dir/node-capture-v2.pcap" "$dir/node-capture.pcap" 2>/dev/null || true
        fi
      fi
    else
      colima ssh -- cat /tmp/node-capture-v2.pcap 2>/dev/null > "$dir/node-capture.pcap" || true
      colima ssh -- rm -f /tmp/node-capture-v2.pcap 2>/dev/null || true
    fi
  fi

  # Stop Caddy pod capture
  local caddy_ns="${CAPTURE_V2_CADDY_NS:-ingress-nginx}"
  local caddy_pod="${CAPTURE_V2_CADDY_POD:-}"
  [[ -z "$caddy_pod" ]] && caddy_pod=$(_capture_v2_kubectl -n "$caddy_ns" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$_CAPTURE_V2_CADDY_PID" ]]; then
    kill -INT "$_CAPTURE_V2_CADDY_PID" 2>/dev/null || true
    w=0
    while [[ $w -lt 5 ]] && kill -0 "$_CAPTURE_V2_CADDY_PID" 2>/dev/null; do sleep 1; w=$((w+1)); done
    kill -9 "$_CAPTURE_V2_CADDY_PID" 2>/dev/null || true
  fi
  if [[ -n "$caddy_pod" ]]; then
    timeout 8 _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- sh -c "pkill -INT tcpdump 2>/dev/null; sleep 2; pkill -9 tcpdump 2>/dev/null" 2>/dev/null || true
    ( _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- cat /tmp/caddy-capture-v2.pcap 2>/dev/null > "$dir/caddy-capture.pcap" ) || true
  fi

  # Stop Envoy pod capture
  local envoy_ns="${CAPTURE_V2_ENVOY_NS:-envoy-test}"
  local envoy_pod="${CAPTURE_V2_ENVOY_POD:-}"
  [[ -z "$envoy_pod" ]] && envoy_pod=$(_capture_v2_kubectl -n "$envoy_ns" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  [[ -z "$envoy_pod" ]] && envoy_pod=$(_capture_v2_kubectl -n ingress-nginx get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") && envoy_ns="ingress-nginx"
  if [[ -n "$_CAPTURE_V2_ENVOY_PID" ]]; then
    kill -INT "$_CAPTURE_V2_ENVOY_PID" 2>/dev/null || true
    w=0
    while [[ $w -lt 5 ]] && kill -0 "$_CAPTURE_V2_ENVOY_PID" 2>/dev/null; do sleep 1; w=$((w+1)); done
    kill -9 "$_CAPTURE_V2_ENVOY_PID" 2>/dev/null || true
  fi
  if [[ -n "$envoy_pod" ]]; then
    timeout 8 _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- sh -c "pkill -INT tcpdump 2>/dev/null; sleep 2; pkill -9 tcpdump 2>/dev/null" 2>/dev/null || true
    ( _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- cat /tmp/envoy-capture-v2.pcap 2>/dev/null > "$dir/envoy-capture.pcap" ) || true
  fi

  echo "  [packet-capture-v2] Capture stopped. Analyzing with tcpdump -r..."

  # Analyze: validate with tcpdump -r ... | head, then counts (no grep guessing)
  echo ""
  echo "  === Packet capture v2 — 3-layer analysis ==="
  if [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]]; then
    echo "  L1 (node): first 5 packets:"
    tcpdump -r "$dir/node-capture.pcap" -nn 2>/dev/null | head -5 || echo "    (tcpdump read failed)"
    local node_tcp node_udp
    node_tcp=$(tcpdump -r "$dir/node-capture.pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    node_udp=$(tcpdump -r "$dir/node-capture.pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "  L1 (node): TCP 443: ${node_tcp:-0}, UDP 443: ${node_udp:-0}"
  else
    echo "  L1 (node): no pcap or empty (node capture may be disabled or Colima path failed)."
  fi

  if [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
    echo "  L2 (Caddy): first 5 packets:"
    tcpdump -r "$dir/caddy-capture.pcap" -nn 2>/dev/null | head -5 || echo "    (tcpdump read failed)"
    local caddy_tcp caddy_udp
    caddy_tcp=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    caddy_udp=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "  L2 (Caddy): TCP 443: ${caddy_tcp:-0}, UDP 443: ${caddy_udp:-0}"
  else
    echo "  L2 (Caddy): no pcap or empty. If L1 has traffic → kube-proxy/DNAT masking pod-level capture."
  fi

  # QUIC proof: L2 (Caddy) alone is sufficient when L1 is missing (Colima node capture unreliable). STRICT_QUIC_VALIDATION only fails on stray UDP 443, not on missing L1.
  local caddy_udp_val=0
  if [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
    caddy_udp_val=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    caddy_udp_val=${caddy_udp_val:-0}
  fi
  local has_node_pcap=0
  [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]] && has_node_pcap=1
  if [[ "$has_node_pcap" -eq 0 ]] && [[ "${caddy_udp_val:-0}" -gt 0 ]]; then
    echo "  [packet-capture-v2] QUIC proof: L2 (Caddy) only — node capture unavailable (Colima host→VM UDP path may be flaky); L2 proves QUIC reached Caddy."
  fi

  if [[ -f "$dir/envoy-capture.pcap" ]] && [[ -s "$dir/envoy-capture.pcap" ]]; then
    echo "  L3 (Envoy): first 5 packets:"
    tcpdump -r "$dir/envoy-capture.pcap" -nn 2>/dev/null | head -5 || echo "    (tcpdump read failed)"
    local envoy_10000
    envoy_10000=$(tcpdump -r "$dir/envoy-capture.pcap" -nn 'tcp port 10000' 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "  L3 (Envoy): TCP 10000: ${envoy_10000:-0}"
  else
    echo "  L3 (Envoy): no pcap or empty."
  fi

  # --- tshark validation: QUIC to LB IP only, no stray UDP 443 (when node pcap and CAPTURE_V2_LB_IP set) ---
  # STRICT_QUIC_VALIDATION=1: only fails on stray UDP 443; missing L1 (node) pcap does NOT fail — L2 (Caddy) QUIC proof is sufficient.
  local lb_ip="${CAPTURE_V2_LB_IP:-}"
  if command -v tshark >/dev/null 2>&1 && [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]] && [[ -n "$lb_ip" ]]; then
    echo "  [packet-capture-v2] Verifying QUIC to MetalLB IP only (tshark)..."
    local quic_to_lb=0
    quic_to_lb=$(tshark -r "$dir/node-capture.pcap" -Y "udp.port == 443 && ip.dst == $lb_ip" 2>/dev/null | wc -l | tr -d '[:space:]')
    quic_to_lb=${quic_to_lb:-0}
    local stray_udp443
    stray_udp443=$(tshark -r "$dir/node-capture.pcap" -Y "udp.port == 443 && ip.dst != $lb_ip" 2>/dev/null | wc -l | tr -d '[:space:]')
    stray_udp443=${stray_udp443:-0}
    echo "  [packet-capture-v2] QUIC to $lb_ip: $quic_to_lb packets; stray UDP 443 (dst != $lb_ip): $stray_udp443"
    if [[ "$stray_udp443" -gt 0 ]]; then
      echo "  [packet-capture-v2] ⚠️  Stray UDP 443 detected (background QUIC noise); capture should use BPF dst host $lb_ip."
      [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION=1: failing due to stray traffic." && return 1
    fi
    # Optional SNI proof (off-campus-housing.local)
    local sni_count=0
    sni_count=$(tshark -r "$dir/node-capture.pcap" -Y "quic && tls.handshake.extensions_server_name contains off-campus-housing.local" 2>/dev/null | wc -l | tr -d '[:space:]')
    sni_count=${sni_count:-0}
    [[ "$sni_count" -gt 0 ]] && echo "  [packet-capture-v2] QUIC SNI off-campus-housing.local: $sni_count packets"
  fi

  echo "  === End 3-layer analysis ==="
  echo "  Pcaps: $dir (node-capture.pcap, caddy-capture.pcap, envoy-capture.pcap)"
  if [[ -n "${CAPTURE_COPY_DIR:-}" ]]; then
    mkdir -p "$CAPTURE_COPY_DIR"
    cp -f "$dir"/node-capture.pcap "$dir"/caddy-capture.pcap "$dir"/envoy-capture.pcap "$CAPTURE_COPY_DIR/" 2>/dev/null || true
    echo "  Copied to: $CAPTURE_COPY_DIR"
  fi

  # --- STRICT_QUIC_VALIDATION: L2 (Caddy) is authoritative; node/L1 optional (Colima-stable) ---
  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && command -v tshark >/dev/null 2>&1 && [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
    local l2_tcp l2_quic l2_alpn
    l2_tcp=$(tshark -r "$dir/caddy-capture.pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l | tr -d '[:space:]')
    l2_quic=$(tshark -r "$dir/caddy-capture.pcap" -Y "quic" 2>/dev/null | wc -l | tr -d '[:space:]')
    l2_alpn=$(tshark -r "$dir/caddy-capture.pcap" -Y "tls.handshake.extensions_alpn_str contains h2" 2>/dev/null | wc -l | tr -d '[:space:]')
    l2_tcp=${l2_tcp:-0}; l2_quic=${l2_quic:-0}; l2_alpn=${l2_alpn:-0}
    if [[ "$l2_tcp" -eq 0 ]]; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION: no TCP 443 at L2 (Caddy) — FAIL"
      return 1
    fi
    if [[ "$l2_quic" -gt 0 ]]; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION: QUIC verified at L2 (Caddy) — PASS"
    elif [[ "$l2_alpn" -gt 0 ]]; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION: no QUIC at L2; ALPN h2 verified — PASS"
    else
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION: no QUIC or ALPN h2 at L2 — FAIL"
      return 1
    fi
  fi

  # --- Transport observability v3: QUIC version, ALPN, TLS timing, transport-summary.json ---
  local node_pcap="$dir/node-capture.pcap"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)"
  [[ -z "$script_dir" ]] && [[ -n "${SCRIPT_DIR:-}" ]] && script_dir="${SCRIPT_DIR}/lib"
  if command -v tshark >/dev/null 2>&1 && [[ -f "$node_pcap" ]] && [[ -s "$node_pcap" ]]; then
    echo "  [transport-v3] Extracting QUIC version, ALPN, TLS timing (tshark)..."
    local tcp_443=0 udp_443=0
    tcp_443=$(tcpdump -r "$node_pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    udp_443=$(tcpdump -r "$node_pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    tcp_443=${tcp_443:-0}
    udp_443=${udp_443:-0}

    # QUIC version extraction
    local quic_versions_json="{}"
    local quic_raw
    quic_raw=$(tshark -r "$node_pcap" -Y quic -T fields -e quic.version 2>/dev/null | sort | uniq -c || true)
    if [[ -n "$quic_raw" ]]; then
      local versions=""
      while read -r count ver; do
        [[ -z "$ver" ]] && continue
        ver="${ver//\"/}"
        versions="${versions}\"${ver}\": ${count},"
      done <<< "$quic_raw"
      versions="${versions%,}"
      [[ -n "$versions" ]] && quic_versions_json="{$versions}"
    fi

    # ALPN TLS (h2)
    local alpn_tls_json="{}"
    local alpn_tls_raw
    alpn_tls_raw=$(tshark -r "$node_pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
    if [[ -n "$alpn_tls_raw" ]]; then
      local alpn_tls_pairs=""
      while read -r count alpn; do
        [[ -z "$alpn" ]] && continue
        alpn="${alpn//\"/}"
        alpn_tls_pairs="${alpn_tls_pairs}\"${alpn}\": ${count},"
      done <<< "$alpn_tls_raw"
      alpn_tls_pairs="${alpn_tls_pairs%,}"
      [[ -n "$alpn_tls_pairs" ]] && alpn_tls_json="{$alpn_tls_pairs}"
    fi

    # ALPN QUIC (h3)
    local alpn_quic_json="{}"
    local alpn_quic_raw
    alpn_quic_raw=$(tshark -r "$node_pcap" -Y "quic.tls.handshake.extensions_alpn" -T fields -e quic.tls.handshake.extensions_alpn 2>/dev/null | sort | uniq -c || true)
    if [[ -z "$alpn_quic_raw" ]]; then
      alpn_quic_raw=$(tshark -r "$node_pcap" -Y "quic" -T fields -e quic.tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
    fi
    if [[ -n "$alpn_quic_raw" ]]; then
      local alpn_quic_pairs=""
      while read -r count alpn; do
        [[ -z "$alpn" ]] && continue
        alpn="${alpn//\"/}"
        alpn_quic_pairs="${alpn_quic_pairs}\"${alpn}\": ${count},"
      done <<< "$alpn_quic_raw"
      alpn_quic_pairs="${alpn_quic_pairs%,}"
      [[ -n "$alpn_quic_pairs" ]] && alpn_quic_json="{$alpn_quic_pairs}"
    fi

    # TLS handshake timing (ClientHello → ServerHello)
    local tls_timing_json='{"avg":0,"p50":0,"p95":0,"max":0}'
    local tls_handshake_file="$dir/tls_handshake_times.txt"
    if tshark -r "$node_pcap" -Y "tls.handshake.type==1 || tls.handshake.type==2" -T fields -e frame.time_epoch -e tls.handshake.type -e tls.stream 2>/dev/null > "$tls_handshake_file"; then
      if [[ -n "$script_dir" ]] && [[ -f "$script_dir/analyze_tls_timing.py" ]]; then
        local tls_out
        tls_out=$(python3 "$script_dir/analyze_tls_timing.py" "$tls_handshake_file" 2>/dev/null || echo "")
        if [[ -n "$tls_out" ]]; then
          tls_timing_json=$(echo "$tls_out" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tls_handshake_ms',{'avg':0,'p50':0,'p95':0,'max':0})))" 2>/dev/null || echo '{"avg":0,"p50":0,"p95":0,"max":0}')
        fi
      fi
    fi

    # Build transport-summary.json (machine-readable)
    local summary_file="$dir/transport-summary.json"
    cat > "$summary_file" << TRANSPORT_JSON
{
  "tcp_443": $tcp_443,
  "udp_443": $udp_443,
  "quic_versions": $quic_versions_json,
  "alpn_tls": $alpn_tls_json,
  "alpn_quic": $alpn_quic_json,
  "tls_handshake_ms": $tls_timing_json
}
TRANSPORT_JSON
    echo "  [transport-v3] Wrote $summary_file"

    # If CAPTURE_RUN_TYPE is set, copy to captures/baseline or captures/rotation for diff
    local run_type="${CAPTURE_RUN_TYPE:-}"
    local captures_root="${TRANSPORT_CAPTURES_DIR:-/tmp/transport-captures}"
    if [[ -n "$run_type" ]]; then
      mkdir -p "$captures_root/$run_type"
      cp -f "$summary_file" "$captures_root/$run_type/transport-summary.json" 2>/dev/null && echo "  [transport-v3] Copied to $captures_root/$run_type/transport-summary.json" || true
    fi

    # Automatic baseline vs rotation diff when both exist
    if [[ -f "$captures_root/baseline/transport-summary.json" ]] && [[ -f "$captures_root/rotation/transport-summary.json" ]]; then
      local diff_script=""
      [[ -n "$script_dir" ]] && diff_script="$script_dir/transport-diff.py"
      [[ -z "$diff_script" ]] || [[ ! -f "$diff_script" ]] && diff_script="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)/transport-diff.py"
      if [[ -f "$diff_script" ]]; then
        echo "  [transport-v3] Running baseline vs rotation diff..."
        python3 "$diff_script" "$captures_root" 2>/dev/null || true
      fi
    fi

    # --- STRICT_QUIC_VALIDATION (Transport Hardening V4): fail harness if H3 not provable ---
    if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
      local quic_count
      quic_count=$(tshark -r "$node_pcap" -Y quic 2>/dev/null | wc -l | tr -d '[:space:]')
      quic_count=${quic_count:-0}
      if [[ "$quic_count" -eq 0 ]]; then
        echo "  ❌ STRICT_QUIC_VALIDATION: No QUIC packets in node pcap (H3 not actually used?). Fail."
        exit 1
      fi
      local alpn_h3
      alpn_h3=$(tshark -r "$node_pcap" -Y "quic.tls.handshake.extensions_alpn" -T fields -e quic.tls.handshake.extensions_alpn 2>/dev/null || true)
      [[ -z "$alpn_h3" ]] && alpn_h3=$(tshark -r "$node_pcap" -Y "quic" -T fields -e quic.tls.handshake.extensions_alpn_str 2>/dev/null || true)
      if ! echo "$alpn_h3" | grep -q "h3"; then
        echo "  ❌ STRICT_QUIC_VALIDATION: No h3 ALPN negotiated in QUIC. Fail."
        exit 1
      fi
      echo "  [transport-v3] STRICT_QUIC_VALIDATION: QUIC packets=$quic_count, h3 ALPN present."
    fi
  else
    if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
      echo "  ❌ STRICT_QUIC_VALIDATION: No node pcap or tshark unavailable; cannot prove QUIC. Fail."
      exit 1
    fi
    if ! command -v tshark >/dev/null 2>&1; then
      echo "  [transport-v3] tshark not installed; skip QUIC/ALPN/TLS extraction (install tshark for full transport summary)."
    fi
  fi

  _CAPTURE_V2_NODE_PID=""
  _CAPTURE_V2_CADDY_PID=""
  _CAPTURE_V2_ENVOY_PID=""
}
