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
#      CAPTURE_V2_NODE_PCAP_BASENAME — file under VM $HOME for L1 tcpdump -w (default och-node-capture-v2.pcap; /tmp and /var/tmp may deny non-root).
#      CAPTURE_NODE_ONLY=1 — run only node-level capture (no kubectl exec); macOS-proof, no OOM.
#      CAPTURE_RING_BUFFER=1 — when multiple node pcaps exist, merge to node-capture.pcap (mergecap).
#      CAPTURE_V2_TCPDUMP_BUFFER_KB=1024 — tcpdump -B (default 1024; lower reduces OOM / SIGKILL in small pods).
#      CAPTURE_V2_TCPDUMP_NO_BUFFER=1 — omit -B entirely (platform default).
#      CAPTURE_V2_SKIP_UDP443_GUARD=1 — do not fail STRICT when L2 pcap has zero UDP/443 rows (debug only).
#      STRICT_QUIC_VALIDATION=1 — protocol-semantic gate (STRICT uses L1 Colima node tcpdump only; L2/L3 pod capture skipped — stable vs OOM):
#          Requires L2 TCP 443 > 0 and QUIC frames in L2/L1 pcap (tshark -Y quic),
#          not raw UDP:443 counts (overlay/CNI encapsulation can hide direct udp/443 at L2).
#          Optional: CAPTURE_V2_EXPECT_HTTP_VERSION=3 to require caller-confirmed HTTP/3 curl result.
#          Optional: STRICT_CURL_H3_OK=1 as final positive signal when pcap decode is inconclusive.
#      L2 capture BPF: (tcp port 443) or (udp port 443) on -i any (avoids capturing all UDP / high memory use).
#      Do not filter UDP by pod IP (CNI/gif0/flannel path).
#      L1 (Colima): sudo -n tcpdump || tcpdump — no exec (keeps ssh session alive); host-backgrounds colima ssh.
#      Optional cryptographic ALPN in tshark: CAPTURE_V2_TLS_KEYLOG or SSLKEYLOGFILE pointing to NSS key log (curl --http3 with OpenSSL/ngtcp2).
#      h3 ALPN in tshark (preferred; valid across typical builds — avoid quic.tls.handshake.extensions_alpn):
#        quic && tls.handshake.extensions_alpn_str contains "h3"
#        tls.handshake.extensions_alpn_str == "h3"   # one-liner proof; keylog: -o tls.keylog_file:/path
#      Manual debug after a run (path is from "Pcaps: ..." in the log):
#        cd /tmp/packet-captures-v2-<stamp>-<pid>   # your dir will differ
#        ls   # node-capture.pcap, caddy-capture.pcap, envoy-capture.pcap
#        tshark -r caddy-capture.pcap -o tls.keylog_file:/tmp/sslkeys.log -Y "quic" -V | grep -i alpn
#        tshark -r caddy-capture.pcap -o tls.keylog_file:/tmp/sslkeys.log -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str
#      Helpers: count_alpn_h3_quic_packets_in_pcap, quic_alpn_strings_from_pcap in protocol-verification.sh. Debug fields: tshark -G fields | grep -i alpn
#      L2: tcpdump -i any; no per-rotation -G/-W in-pod (single file until SIGINT — avoids OOM from ring + large -B).
# Colima: Node capture only when 'colima' is available; CAPTURE_WARMUP_SECONDS=4 default.
# CAPTURE_V2_SKIP_ALPN_DECODE_PRINT=1 — skip the automatic "tshark -Y quic -V | grep -i alpn" block.
# Safe to source; no set -e so failures in optional steps don't exit the caller.

_CAPTURE_V2_DIR=""
_CAPTURE_V2_NODE_PID=""
_CAPTURE_V2_CADDY_PID=""
_CAPTURE_V2_ENVOY_PID=""
_CAPTURE_V2_NODE_PCAP=""
_CAPTURE_V2_NODE_VM_BN=""
_CAPTURE_V2_CADDY_PCAP=""
_CAPTURE_V2_ENVOY_PCAP=""
KUBECTL_EXEC_TIMEOUT="${KUBECTL_EXEC_TIMEOUT:-15s}"
: "${CAPTURE_V2_NODE_PCAP_BASENAME:=och-node-capture-v2.pcap}"

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
  _CAPTURE_V2_NODE_VM_BN=""
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
  # BPF: when CAPTURE_V2_LB_IP is set, TCP/443 is restricted to the LB. UDP/443 defaults wide (QUIC may show pod IPs after DNAT).
  # Set CAPTURE_V2_L1_UDP_HOST_MATCH=1 to require udp port 443 and host <LB> (cuts background QUIC; may miss QUIC on paths without LB in IPv4).
  local node_filter="(tcp or udp) and port 443"
  if [[ -n "${CAPTURE_V2_LB_IP:-}" ]]; then
    if [[ "${CAPTURE_V2_L1_UDP_HOST_MATCH:-0}" == "1" ]]; then
      node_filter="((udp port 443) and (host ${CAPTURE_V2_LB_IP})) or ((tcp port 443) and host ${CAPTURE_V2_LB_IP})"
      echo "  [packet-capture-v2] L1 (node): BPF (udp port 443 and host $CAPTURE_V2_LB_IP) OR (tcp port 443 and host $CAPTURE_V2_LB_IP) [CAPTURE_V2_L1_UDP_HOST_MATCH=1]"
    else
      node_filter="(udp port 443) or ((tcp port 443) and host ${CAPTURE_V2_LB_IP})"
      echo "  [packet-capture-v2] L1 (node): BPF udp port 443 OR (tcp port 443 and host $CAPTURE_V2_LB_IP)"
    fi
  fi
  if command -v colima >/dev/null 2>&1; then
    echo "  [packet-capture-v2] L1 (node): starting tcpdump on Colima VM (sudo -n if available, else tcpdump)..."
    local _nf_q _td_buf=""
    _nf_q=$(printf '%q' "$node_filter")
    if [[ "${CAPTURE_V2_TCPDUMP_NO_BUFFER:-0}" != "1" ]]; then
      _td_buf="-B ${CAPTURE_V2_TCPDUMP_BUFFER_KB:-1024}"
    fi
    local _vm_bn="${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}"
    _CAPTURE_V2_NODE_VM_BN="$_vm_bn"
    # shellcheck disable=SC2086
    # Do not use exec — tcpdump must stay a child of bash so colima ssh keeps the session open until SIGINT.
    colima ssh -- bash -c "if sudo -n true 2>/dev/null; then sudo -n tcpdump -i any ${_td_buf} -nn ${_nf_q} -w \"\$HOME/${_vm_bn}\"; else tcpdump -i any ${_td_buf} -nn ${_nf_q} -w \"\$HOME/${_vm_bn}\"; fi" 2>"$dir/node-capture.log" &
    _CAPTURE_V2_NODE_PID=$!
    _CAPTURE_V2_NODE_PCAP="\$HOME/${_vm_bn}"
    sleep 2
    if ! kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
      echo "  [packet-capture-v2] L1 (node): tcpdump exited early (check $dir/node-capture.log)"
      _CAPTURE_V2_NODE_PID=""
    fi
  else
    echo "  [packet-capture-v2] L1 (node): colima not found; skip node-level capture."
  fi

  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
    if ! command -v colima >/dev/null 2>&1; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION=1 requires Colima for L1 (node) tcpdump; pod capture is disabled in STRICT."
      return 1
    fi
    if [[ -z "${CAPTURE_V2_LB_IP:-}" ]]; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION=1 requires CAPTURE_V2_LB_IP (MetalLB IP) for node BPF (dst host <LB> port 443)."
      return 1
    fi
    if [[ -z "${_CAPTURE_V2_NODE_PID}" ]] || ! kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
      echo "  [packet-capture-v2] STRICT_QUIC_VALIDATION=1 requires L1 node tcpdump running (see $dir/node-capture.log)."
      return 1
    fi
    echo "  [packet-capture-v2] STRICT: skipping L2/L3 in-pod tcpdump (OOM-prone); QUIC proof uses L1 node pcap only → copied to caddy-capture.pcap after stop."
  fi

  # --- Layer 2: Caddy pod (skipped in STRICT — use L1 node pcap as analysis artifact) ---
  if [[ "${STRICT_QUIC_VALIDATION:-0}" != "1" ]] && [[ -n "$caddy_pod" ]]; then
    if _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- which tcpdump >/dev/null 2>&1; then
      local _v2_bpf _td_buf=""
      _v2_bpf="(tcp port 443) or (udp port 443)"
      if [[ "${CAPTURE_V2_TCPDUMP_NO_BUFFER:-0}" != "1" ]]; then
        _td_buf="-B ${CAPTURE_V2_TCPDUMP_BUFFER_KB:-1024}"
      fi
      echo "  [packet-capture-v2] L2 (Caddy $caddy_ns/$caddy_pod): tcpdump -i any BPF '${_v2_bpf}' (no per-pod UDP dst filter)"
      _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- sh -c "tcpdump -i any ${_td_buf} -nn '${_v2_bpf}' -w /tmp/caddy-capture-v2.pcap 2>&1" >> "$dir/caddy-capture.log" 2>&1 &
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

  # --- Layer 3: Envoy pod (optional; skip when CAPTURE_NODE_ONLY=1 or STRICT) ---
  if [[ "${STRICT_QUIC_VALIDATION:-0}" != "1" ]] && [[ "${CAPTURE_NODE_ONLY:-0}" != "1" ]] && [[ -n "$envoy_pod" ]]; then
    if _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- which tcpdump >/dev/null 2>&1; then
      echo "  [packet-capture-v2] L3 (Envoy $envoy_ns/$envoy_pod): starting tcpdump -i eth0 port 10000..."
      local _td_buf_e=""
      if [[ "${CAPTURE_V2_TCPDUMP_NO_BUFFER:-0}" != "1" ]]; then
        _td_buf_e="-B ${CAPTURE_V2_TCPDUMP_BUFFER_KB:-1024}"
      fi
      # shellcheck disable=SC2086
      _capture_v2_kubectl -n "$envoy_ns" exec "$envoy_pod" -- sh -c "tcpdump -i eth0 ${_td_buf_e} -nn 'tcp port 10000' -w /tmp/envoy-capture-v2.pcap 2>&1" >> "$dir/envoy-capture.log" 2>&1 &
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

# After pcaps land in dir: run tshark QUIC verbose decode and show ALPN lines (+ h3 fields). Key log-aware.
_packet_capture_v2_emit_quic_alpn_decode_report() {
  local dir="${1:?directory}"
  export PACKET_CAPTURE_V2_LAST_DIR="$dir"
  local caddy="$dir/caddy-capture.pcap"
  [[ "${CAPTURE_V2_SKIP_ALPN_DECODE_PRINT:-0}" == "1" ]] && return 0
  [[ -f "$caddy" ]] && [[ -s "$caddy" ]] || return 0
  if ! command -v tshark >/dev/null 2>&1; then
    echo "  [packet-capture-v2] ALPN decode: tshark not installed; skip human-readable QUIC ALPN."
    return 0
  fi

  local kl="${CAPTURE_V2_TLS_KEYLOG:-${SSLKEYLOGFILE:-}}"
  local kopt=()
  if [[ -n "$kl" ]] && [[ -f "$kl" ]] && [[ -s "$kl" ]]; then
    kopt=(-o "tls.keylog_file:${kl}")
  fi

  echo ""
  echo "  ┌── QUIC / TLS ALPN decode (L2 caddy-capture.pcap) ─────────────────────────────"
  echo "  │ Pcaps dir:  $dir"
  echo "  │"
  if [[ ${#kopt[@]} -gt 0 ]]; then
    echo "  │ --- tshark -r caddy-capture.pcap -o tls.keylog_file:<file> -Y \"quic\" -V | grep -i alpn ---"
  else
    echo "  │ --- tshark -r caddy-capture.pcap -Y \"quic\" -V | grep -i alpn ---"
  fi
  local _alpn_grep
  _alpn_grep=$(tshark "${kopt[@]}" -r "$caddy" -Y "quic" -V 2>/dev/null | grep -i alpn || true)
  if [[ -n "$_alpn_grep" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      echo "  │ $line"
    done <<< "$_alpn_grep"
  else
    echo "  │ (no ALPN lines matched — need QUIC in pcap; decrypted ALPN usually needs a matching TLSkey log.)"
  fi
  echo "  │"
  echo "  │ --- tls.handshake.extensions_alpn_str == \"h3\" (-T fields) ---"
  local _h3f
  _h3f=$(tshark "${kopt[@]}" -r "$caddy" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | head -20 || true)
  if [[ -n "$_h3f" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      echo "  │ $line"
    done <<< "$_h3f"
  else
    echo "  │ (no rows — same session SSLKEYLOGFILE often required)"
  fi
  if [[ ${#kopt[@]} -gt 0 ]]; then
    echo "  │ Key log: $kl"
  else
    echo "  │ Key log: (none) — set SSLKEYLOGFILE or CAPTURE_V2_TLS_KEYLOG before traffic"
  fi
  echo "  │"
  echo "  │ Copy/paste (run from any directory):"
  if [[ ${#kopt[@]} -gt 0 ]]; then
    printf '  │   cd %q && \\\n' "$dir"
    printf '  │     tshark -r caddy-capture.pcap -o tls.keylog_file:%q -Y "quic" -V | grep -i alpn\n' "$kl"
    printf '  │   cd %q && \\\n' "$dir"
    printf '  │     tshark -r caddy-capture.pcap -o tls.keylog_file:%q \\\n' "$kl"
    printf '  │       -Y %q -T fields -e tls.handshake.extensions_alpn_str\n' 'tls.handshake.extensions_alpn_str == "h3"'
  else
    printf '  │   cd %q && tshark -r caddy-capture.pcap -Y "quic" -V | grep -i alpn\n' "$dir"
    printf '  │   cd %q && tshark -r caddy-capture.pcap \\\n' "$dir"
    printf '  │       -Y %q -T fields -e tls.handshake.extensions_alpn_str\n' 'tls.handshake.extensions_alpn_str == "h3"'
  fi
  echo "  └──────────────────────────────────────────────────────────────────────────────────"
  echo ""
}

# Stop all captures: drain 5s, SIGINT, wait max 5s, force kill, copy pcaps, analyze with tcpdump -r.
stop_and_analyze_captures_v2() {
  [[ "${DISABLE_PACKET_CAPTURE:-0}" == "1" ]] && return 0
  local _pv2_proto_lib
  _pv2_proto_lib="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)"
  [[ -f "${_pv2_proto_lib}/protocol-verification.sh" ]] && source "${_pv2_proto_lib}/protocol-verification.sh"
  local dir
  dir="$(packet_capture_dir)"
  local _pv2_caddy_is_node_copy=0
  local drain="${CAPTURE_DRAIN_SECONDS:-5}"
  echo "  [packet-capture-v2] Drain ${drain}s for in-flight packets..."
  sleep "$drain"

  # Stop node capture (Colima): host PID is the ssh wrapper — always signal tcpdump inside the VM.
  if [[ -n "$_CAPTURE_V2_NODE_PID" ]] && kill -0 "$_CAPTURE_V2_NODE_PID" 2>/dev/null; then
    kill -INT "$_CAPTURE_V2_NODE_PID" 2>/dev/null || true
  fi
  if command -v colima >/dev/null 2>&1; then
    colima ssh -- bash -c "sudo -n pkill -INT -x tcpdump 2>/dev/null || pkill -INT -x tcpdump 2>/dev/null || true" 2>/dev/null || true
    local w=0
    while [[ $w -lt 15 ]]; do
      if ! colima ssh -- bash -c "pgrep -x tcpdump >/dev/null 2>&1" 2>/dev/null; then
        break
      fi
      sleep 1
      w=$((w+1))
    done
    if colima ssh -- bash -c "pgrep -x tcpdump >/dev/null 2>&1" 2>/dev/null; then
      echo "  [packet-capture-v2] L1 (node): tcpdump still running after SIGINT; copying partial pcap anyway."
    fi
  fi
  # Copy node pcap from Colima to host (single file or ring-buffer rotated files)
  local _vm_bn_stop="${_CAPTURE_V2_NODE_VM_BN:-${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}}"
  if command -v colima >/dev/null 2>&1 && [[ -n "$_vm_bn_stop" ]]; then
    if [[ "${CAPTURE_RING_BUFFER:-1}" == "1" ]]; then
      local _files
      _files=$(colima ssh -- bash -c "ls -v \"\$HOME/${_vm_bn_stop}\"* 2>/dev/null" 2>/dev/null || true)
      if [[ -n "$_files" ]]; then
        while read -r _f; do
          [[ -z "$_f" ]] && continue
          _fname=$(basename "$_f")
          colima ssh -- cat "$_f" 2>/dev/null > "$dir/$_fname" || true
        done <<< "$_files"
        colima ssh -- bash -c "rm -f \"\$HOME/${_vm_bn_stop}\"*" 2>/dev/null || true
        if command -v mergecap >/dev/null 2>&1; then
          local _list
          _list=$(ls "$dir"/"${_vm_bn_stop}"* 2>/dev/null || true)
          if [[ -n "$_list" ]]; then
            mergecap -w "$dir/node-capture.pcap" $(echo "$_list" | tr '\n' ' ') 2>/dev/null && echo "  [packet-capture-v2] Merged ring-buffer pcaps to $dir/node-capture.pcap" || cp -f "$dir/${_vm_bn_stop}" "$dir/node-capture.pcap" 2>/dev/null || true
          else
            cp -f "$dir/${_vm_bn_stop}" "$dir/node-capture.pcap" 2>/dev/null || true
          fi
        else
          cp -f "$dir/${_vm_bn_stop}" "$dir/node-capture.pcap" 2>/dev/null || true
        fi
      else
        colima ssh -- bash -c "cat \"\$HOME/${_vm_bn_stop}\"" 2>/dev/null > "$dir/node-capture.pcap" || true
        colima ssh -- bash -c "rm -f \"\$HOME/${_vm_bn_stop}\"" 2>/dev/null || true
      fi
    else
      colima ssh -- bash -c "cat \"\$HOME/${_vm_bn_stop}\"" 2>/dev/null > "$dir/node-capture.pcap" || true
      colima ssh -- bash -c "rm -f \"\$HOME/${_vm_bn_stop}\"" 2>/dev/null || true
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
  if [[ "${STRICT_QUIC_VALIDATION:-0}" != "1" ]] && [[ -n "$caddy_pod" ]]; then
    timeout 8 _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- sh -c "pkill -INT tcpdump 2>/dev/null; sleep 2; pkill -9 tcpdump 2>/dev/null" 2>/dev/null || true
    ( _capture_v2_kubectl -n "$caddy_ns" exec "$caddy_pod" -- cat /tmp/caddy-capture-v2.pcap 2>/dev/null > "$dir/caddy-capture.pcap" ) || true
  elif [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
    rm -f "$dir/caddy-capture.pcap" 2>/dev/null || true
  fi

  # STRICT: tshark / v6 / v7 read caddy-capture.pcap — use L1 node pcap (in-pod capture intentionally skipped).
  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
    if [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]]; then
      cp -f "$dir/node-capture.pcap" "$dir/caddy-capture.pcap"
      _pv2_caddy_is_node_copy=1
      echo "  [packet-capture-v2] STRICT: caddy-capture.pcap ← L1 node pcap (single stable capture path for QUIC forensics)."
    else
      echo "  [packet-capture-v2] STRICT: L1 node pcap missing or empty — cannot populate caddy-capture.pcap."
    fi
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
    if [[ "${_pv2_caddy_is_node_copy:-0}" == "1" ]]; then
      echo "  L2 artifact (STRICT = L1 node copy): first 5 packets:"
    else
      echo "  L2 (Caddy pod): first 5 packets:"
    fi
    tcpdump -r "$dir/caddy-capture.pcap" -nn 2>/dev/null | head -5 || echo "    (tcpdump read failed)"
    local caddy_tcp caddy_udp
    caddy_tcp=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    caddy_udp=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    if [[ "${_pv2_caddy_is_node_copy:-0}" == "1" ]]; then
      echo "  L2 artifact counts (= node): TCP 443: ${caddy_tcp:-0}, UDP 443: ${caddy_udp:-0}"
    else
      echo "  L2 (Caddy pod): TCP 443: ${caddy_tcp:-0}, UDP 443: ${caddy_udp:-0}"
    fi
  else
    echo "  L2 (Caddy): no pcap or empty. If L1 has traffic → kube-proxy/DNAT masking pod-level capture."
  fi

  # QUIC proof helper: L2 (Caddy) may be sufficient when L1 is missing (Colima node capture unreliable).
  local caddy_udp_val=0
  if [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
    caddy_udp_val=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    caddy_udp_val=${caddy_udp_val:-0}
  fi
  local has_node_pcap=0
  [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]] && has_node_pcap=1
  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && [[ "${_pv2_caddy_is_node_copy:-0}" == "1" ]]; then
    echo "  [packet-capture-v2] QUIC proof: STRICT mode uses Colima node capture only (no in-pod tcpdump)."
  elif [[ "$has_node_pcap" -eq 0 ]] && [[ "${caddy_udp_val:-0}" -gt 0 ]]; then
    echo "  [packet-capture-v2] QUIC proof: L2 (Caddy) only — node capture unavailable (Colima host→VM UDP path may be flaky); L2 proves QUIC reached Caddy."
  fi

  # STRICT: require UDP/443 in analysis pcap for in-pod capture (OOM signal). Node-only STRICT skips this — stf0 may omit UDP:443 text rows while QUIC exists.
  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && [[ "${CAPTURE_V2_SKIP_UDP443_GUARD:-0}" != "1" ]] && [[ "${_pv2_caddy_is_node_copy:-0}" != "1" ]]; then
    if [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]] && [[ "${caddy_udp_val:-0}" -eq 0 ]]; then
      echo "  ❌ STRICT capture guard: analysis pcap has zero UDP port 443 (QUIC not seen on wire — check tcpdump / BPF). CAPTURE_V2_SKIP_UDP443_GUARD=1 bypasses (debug only)."
      return 1
    fi
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

  # --- Informational tshark: QUIC vs MetalLB IP on UDP/443 (bidirectional: ip.src or ip.dst) ---
  # Return-path QUIC often has ip.dst = client, not LB — do not use ip.dst==LB alone.
  # After DNAT, node taps may show QUIC only on pod/overlay IPs (no $lb_ip on UDP) — that is not "background noise".
  local lb_ip="${CAPTURE_V2_LB_IP:-}"
  if command -v tshark >/dev/null 2>&1 && [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]] && [[ -n "$lb_ip" ]]; then
    echo "  [packet-capture-v2] QUIC / UDP:443 vs MetalLB $lb_ip (tshark)..."
    local quic_on_lb_path=0
    quic_on_lb_path=$(tshark -r "$dir/node-capture.pcap" -Y "quic && udp.port == 443 && ip.addr == $lb_ip" 2>/dev/null | wc -l | tr -d '[:space:]')
    quic_on_lb_path=${quic_on_lb_path:-0}
    local udp443_on_lb_path=0
    udp443_on_lb_path=$(tshark -r "$dir/node-capture.pcap" -Y "udp.port == 443 && ip.addr == $lb_ip" 2>/dev/null | wc -l | tr -d '[:space:]')
    udp443_on_lb_path=${udp443_on_lb_path:-0}
    local udp443_total=0
    udp443_total=$(tshark -r "$dir/node-capture.pcap" -Y "udp.port == 443" 2>/dev/null | wc -l | tr -d '[:space:]')
    udp443_total=${udp443_total:-0}
    local udp443_without_lb=0
    udp443_without_lb=$(tshark -r "$dir/node-capture.pcap" -Y "udp.port == 443 && not ip.addr == $lb_ip" 2>/dev/null | wc -l | tr -d '[:space:]')
    udp443_without_lb=${udp443_without_lb:-0}
    echo "  [packet-capture-v2]   QUIC+udp:443+ip.addr $lb_ip: $quic_on_lb_path  |  UDP/443 total: $udp443_total  |  UDP/443 without $lb_ip in IPv4: $udp443_without_lb"
    if [[ "$udp443_on_lb_path" -eq 0 ]] && [[ "$udp443_total" -gt 0 ]]; then
      echo "  [packet-capture-v2] ℹ️  QUIC/UDP:443 is visible on this pcap but IPv4 endpoints never include MetalLB $lb_ip (typical after DNAT / overlay on node capture). Forensics still use the full pcap."
    fi
    if [[ "$udp443_on_lb_path" -gt 0 ]] && [[ "$udp443_without_lb" -gt 0 ]]; then
      echo "  [packet-capture-v2] ⚠️  Mixed UDP/443: some rows include $lb_ip and some do not — possible extra QUIC/TLS clients on this interface; narrow BPF or reduce parallel traffic if you need a single-flow pcap."
    fi
    # Optional SNI proof (off-campus-housing.test)
    local sni_count=0
    sni_count=$(tshark -r "$dir/node-capture.pcap" -Y "quic && tls.handshake.extensions_server_name contains off-campus-housing.test" 2>/dev/null | wc -l | tr -d '[:space:]')
    sni_count=${sni_count:-0}
    [[ "$sni_count" -gt 0 ]] && echo "  [packet-capture-v2] QUIC SNI off-campus-housing.test: $sni_count packets"
  fi

  echo "  === End 3-layer analysis ==="
  echo "  Pcaps: $dir (node-capture.pcap, caddy-capture.pcap, envoy-capture.pcap)"
  if [[ -n "${CAPTURE_COPY_DIR:-}" ]]; then
    mkdir -p "$CAPTURE_COPY_DIR"
    cp -f "$dir"/node-capture.pcap "$dir"/caddy-capture.pcap "$dir"/envoy-capture.pcap "$CAPTURE_COPY_DIR/" 2>/dev/null || true
    echo "  Copied to: $CAPTURE_COPY_DIR"
  fi

  # --- Transport observability v3: QUIC version, ALPN, TLS timing, transport-summary.json ---
  local transport_pcap="$dir/node-capture.pcap"
  if [[ ! -f "$transport_pcap" ]] || [[ ! -s "$transport_pcap" ]]; then
    transport_pcap="$dir/caddy-capture.pcap"
    if [[ -f "$transport_pcap" ]] && [[ -s "$transport_pcap" ]]; then
      echo "  [transport-v3] L1 node pcap missing or empty; using L2 (Caddy) pcap for QUIC/ALPN summary."
    else
      transport_pcap=""
    fi
  fi
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)"
  [[ -z "$script_dir" ]] && [[ -n "${SCRIPT_DIR:-}" ]] && script_dir="${SCRIPT_DIR}/lib"
  if command -v tshark >/dev/null 2>&1 && [[ -n "$transport_pcap" ]]; then
    echo "  [transport-v3] Extracting QUIC version, ALPN, TLS timing (tshark)..."
    local tcp_443=0 udp_443=0
    tcp_443=$(tcpdump -r "$transport_pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    udp_443=$(tcpdump -r "$transport_pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    tcp_443=${tcp_443:-0}
    udp_443=${udp_443:-0}

    # QUIC version extraction
    local quic_versions_json="{}"
    local quic_raw
    quic_raw=$(tshark -r "$transport_pcap" -Y quic -T fields -e quic.version 2>/dev/null | sort | uniq -c || true)
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
    alpn_tls_raw=$(tshark -r "$transport_pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
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
    local alpn_quic_raw=""
    if type quic_alpn_strings_from_pcap >/dev/null 2>&1; then
      alpn_quic_raw=$(quic_alpn_strings_from_pcap "$transport_pcap" | sort | uniq -c || true)
    fi
    if [[ -z "$alpn_quic_raw" ]]; then
      alpn_quic_raw=$(tshark -r "$transport_pcap" -Y 'quic && tls.handshake.extensions_alpn_str contains "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
    fi
    if [[ -z "$alpn_quic_raw" ]]; then
      alpn_quic_raw=$(tshark -r "$transport_pcap" -Y 'quic' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
    fi
    if [[ -z "$alpn_quic_raw" ]]; then
      alpn_quic_raw=$(tshark -r "$transport_pcap" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
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
    if tshark -r "$transport_pcap" -Y "tls.handshake.type==1 || tls.handshake.type==2" -T fields -e frame.time_epoch -e tls.handshake.type -e tls.stream 2>/dev/null > "$tls_handshake_file"; then
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

  else
    if ! command -v tshark >/dev/null 2>&1; then
      echo "  [transport-v3] tshark not installed; skip QUIC/ALPN/TLS extraction (install tshark for full transport summary)."
    fi
  fi

  # Human-readable QUIC ALPN (same idea as: cd \$dir; tshark -r caddy-capture.pcap -o tls.keylog_file:... -Y quic -V | grep -i alpn)
  _packet_capture_v2_emit_quic_alpn_decode_report "$dir"

  # --- STRICT_QUIC_VALIDATION ---
  # Transport invariant v6 (CNI-agnostic):
  #   - Earlier: L2 UDP/443 guard (zero rows → fail fast; unstable capture vs transport).
  #   - Must see L2 TCP 443 (ingress path present).
  #   - Hard requirement is protocol evidence from any one signal:
  #       (a) QUIC frames found, (b) ALPN h3 decode found, (c) caller-reported HTTP/3 curl success.
  #   - Missing L1 is informational only when L2 has protocol evidence.
  if [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]]; then
    local l2_tcp_count=0
    if [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
      l2_tcp_count=$(tcpdump -r "$dir/caddy-capture.pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    fi
    l2_tcp_count=${l2_tcp_count:-0}
    [[ "$l2_tcp_count" =~ ^[0-9]+$ ]] || l2_tcp_count=0

    if [[ "$l2_tcp_count" -eq 0 ]]; then
      echo "  ❌ STRICT_QUIC_VALIDATION: no TCP 443 at L2 (Caddy ingress missing)."
      return 1
    fi

    local expect_http_version="${CAPTURE_V2_EXPECT_HTTP_VERSION:-}"
    if [[ -n "$expect_http_version" ]] && [[ "${CAPTURE_V2_HTTP_VERSION:-}" != "$expect_http_version" ]]; then
      echo "  ❌ STRICT_QUIC_VALIDATION: expected HTTP version $expect_http_version but got '${CAPTURE_V2_HTTP_VERSION:-unset}'."
      return 1
    fi

    local has_l2_pcap=0
    [[ -f "$dir/caddy-capture.pcap" ]] && [[ -s "$dir/caddy-capture.pcap" ]] && has_l2_pcap=1
    local has_l1_pcap=0
    [[ -f "$dir/node-capture.pcap" ]] && [[ -s "$dir/node-capture.pcap" ]] && has_l1_pcap=1
    local curl_h3_ok="${STRICT_CURL_H3_OK:-0}"
    [[ "$curl_h3_ok" != "1" ]] && [[ "${GRPC_HTTP3_HEALTH_OK:-0}" == "1" ]] && [[ "${CAPTURE_V2_HTTP_VERSION:-}" == "3" ]] && curl_h3_ok=1
    local l2_quic_count=0
    local l2_alpn_h3_count=0
    local l1_quic_count=0

    local forensic_dir="${script_dir}/quic-forensic"
    local forensic_analyzer="${forensic_dir}/analyze-quic-v6.sh"
    [[ ! -x "$forensic_analyzer" ]] && forensic_analyzer="${forensic_dir}/analyze-quic-v5.sh"
    [[ ! -x "$forensic_analyzer" ]] && forensic_analyzer="${forensic_dir}/analyze-quic.sh"
    local forensic_builder="${forensic_dir}/build-ci-artifact.sh"
    local forensic_json=""
    local forensic_summary="$dir/transport-summary-v6.json"

    if [[ "$has_l2_pcap" -eq 1 ]] && [[ -x "$forensic_builder" ]]; then
      if "$forensic_builder" "$dir/caddy-capture.pcap" "${CAPTURE_V2_TLS_KEYLOG:-}" >"$forensic_summary" 2>/dev/null; then
        echo "  [STRICT] forensic artifact: $forensic_summary"
      else
        rm -f "$forensic_summary" 2>/dev/null || true
      fi
    fi
    local forensic_v7="${forensic_dir}/analyze-quic-v7.sh"
    if [[ "$has_l2_pcap" -eq 1 ]] && [[ -x "$forensic_v7" ]] && [[ -s "$dir/caddy-capture.pcap" ]]; then
      if "$forensic_v7" "$dir/caddy-capture.pcap" "${CAPTURE_V2_TLS_KEYLOG:-}" >"$dir/transport-summary-v7.json" 2>/dev/null; then
        echo "  [STRICT] forensic v7 artifact: $dir/transport-summary-v7.json"
      else
        jq -n \
          --arg err "analyze-quic-v7 failed (no decodable QUIC in pcap or v6 analyzer error); v7 strict gate needs QUIC+TLS decode" \
          --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
          '{
            valid: false,
            error: $err,
            quic: {frame_count: 0, versions: [], packet_number_spaces: [], version_negotiation_packets: 0},
            handshake: {initial_packet_time: null, first_handshake_packet_time: null, first_1rtt_packet_time: null, handshake_duration_seconds: null},
            tls: {selected_cipher_suite: null, certificate_sha256: null, alpn_protocol: null},
            transport_behavior: {
              zero_rtt_detected: false,
              spin_bit: {supported: false, observed: false, transitions: 0, estimated_rtt_seconds: null},
              loss_estimate: 0,
              congestion_estimate_packets_in_flight: 0,
              congestion_estimate_heuristic: "analyzer-failed-stub"
            },
            connection: {unique_destination_cids: 0, cid_rotation_detected: false, key_phase_transitions: 0},
            correlation: {trace_ids_seen: [], jaeger_trace_linked: false},
            capture_window: {start_epoch: null, end_epoch: null},
            ci_metadata: {transport_invariant_version: "v7", generated_at: $ts, forensic_upstream: "stub-v7-failure"}
          }' >"$dir/transport-summary-v7.json" 2>/dev/null || rm -f "$dir/transport-summary-v7.json" 2>/dev/null || true
        echo "  [STRICT] forensic v7 stub (analyzer failed): $dir/transport-summary-v7.json"
      fi
    fi

    if [[ "$has_l2_pcap" -eq 1 ]] && [[ -x "$forensic_analyzer" ]]; then
      forensic_json="$("$forensic_analyzer" "$dir/caddy-capture.pcap" "${CAPTURE_V2_TLS_KEYLOG:-}" 2>/dev/null || true)"
      if [[ -n "$forensic_json" ]] && command -v jq >/dev/null 2>&1; then
        l2_quic_count="$(echo "$forensic_json" | jq -r '.quic_frame_count // 0' 2>/dev/null || echo 0)"
      fi
    fi
    l2_quic_count=${l2_quic_count:-0}
    [[ "$l2_quic_count" =~ ^[0-9]+$ ]] || l2_quic_count=0

    if [[ "$has_l2_pcap" -eq 1 ]] && command -v tshark >/dev/null 2>&1; then
      if [[ -n "${CAPTURE_V2_TLS_KEYLOG:-}" ]] && [[ -f "${CAPTURE_V2_TLS_KEYLOG}" ]]; then
        l2_alpn_h3_count="$(tshark -o tls.keylog_file:"${CAPTURE_V2_TLS_KEYLOG}" -r "$dir/caddy-capture.pcap" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | wc -l | tr -d '[:space:]')"
      else
        l2_alpn_h3_count="$(tshark -r "$dir/caddy-capture.pcap" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | wc -l | tr -d '[:space:]')"
      fi
    fi
    l2_alpn_h3_count=${l2_alpn_h3_count:-0}
    [[ "$l2_alpn_h3_count" =~ ^[0-9]+$ ]] || l2_alpn_h3_count=0

    local l1_quic_any=0
    if [[ "$has_l1_pcap" -eq 1 ]] && command -v tshark >/dev/null 2>&1; then
      l1_quic_any="$(tshark -r "$dir/node-capture.pcap" -Y "quic && udp.port == 443" 2>/dev/null | wc -l | tr -d '[:space:]')"
      if [[ -n "${CAPTURE_V2_LB_IP:-}" ]]; then
        l1_quic_count="$(tshark -r "$dir/node-capture.pcap" -Y "quic && udp.port == 443 && ip.addr == ${CAPTURE_V2_LB_IP}" 2>/dev/null | wc -l | tr -d '[:space:]')"
      else
        l1_quic_count="$l1_quic_any"
      fi
    fi
    l1_quic_count=${l1_quic_count:-0}
    l1_quic_any=${l1_quic_any:-0}
    [[ "$l1_quic_count" =~ ^[0-9]+$ ]] || l1_quic_count=0
    [[ "$l1_quic_any" =~ ^[0-9]+$ ]] || l1_quic_any=0

    echo "  🔎 QUIC frame count (L2): $l2_quic_count"
    echo "  🔎 ALPN h3 count (L2): $l2_alpn_h3_count"
    if [[ "$has_l1_pcap" -eq 1 ]]; then
      if [[ -n "${CAPTURE_V2_LB_IP:-}" ]]; then
        echo "  🔎 QUIC rows (L1 node, any path): $l1_quic_any; rows with ip.addr ${CAPTURE_V2_LB_IP}: $l1_quic_count"
      else
        echo "  🔎 QUIC frame count (L1): $l1_quic_count"
      fi
    fi
    [[ "$has_l1_pcap" -eq 0 ]] && echo "  ℹ️ L1 node capture missing (overlay/CNI may encapsulate path)"

    if [[ "$l2_quic_count" -gt 0 ]] || [[ "$l1_quic_count" -gt 0 ]] || [[ "$l1_quic_any" -gt 0 ]]; then
      echo "  ✅ STRICT transport validation (v6): QUIC protocol evidence found"
      return 0
    fi
    if [[ "$l2_alpn_h3_count" -gt 0 ]]; then
      echo "  ✅ STRICT transport validation (v6): ALPN h3 evidence found"
      return 0
    fi
    if [[ "$curl_h3_ok" == "1" ]]; then
      echo "  ⚠️  STRICT transport validation (v6): curl reported HTTP/3 success without QUIC decode evidence"
      if [[ ! -s "$forensic_summary" ]] && command -v jq >/dev/null 2>&1; then
        jq -n \
          --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
          '{
            valid: true,
            curl_http3_only_evidence: true,
            note: "pcap had no decodable QUIC/ALPN; curl --http3-only reached edge with HTTP version 3",
            packet_number_spaces: [],
            tls: {selected_cipher_suite: null, certificate_sha256: null},
            ci_metadata: {generated_at: $ts, transport_invariant_version: "v6", forensic_mode: "curl-only-fallback"}
          }' >"$forensic_summary"
        echo "  [STRICT] wrote minimal forensic artifact (curl-only): $forensic_summary"
      fi
      return 0
    fi

    echo "  ❌ STRICT transport validation (v6): no QUIC protocol evidence (no QUIC frames, no ALPN h3, curl H3 not asserted)."
    return 1
  fi

  _CAPTURE_V2_NODE_PID=""
  _CAPTURE_V2_CADDY_PID=""
  _CAPTURE_V2_ENVOY_PID=""
}
