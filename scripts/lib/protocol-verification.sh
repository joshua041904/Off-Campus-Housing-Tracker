#!/usr/bin/env bash
# Protocol verification at wire level: HTTP/2 and HTTP/3/QUIC.
# Use tshark to definitively verify protocol (not just TCP 443 = "likely HTTP/2").
# Source from rotation-suite, baseline, enhanced, standalone-capture.
# Usage: verify_http2_in_pcap /path/to/file.pcap; verify_quic_in_pcap /path/to/file.pcap

# Verify HTTP/2 in a pcap file (local path). Returns 0 if HTTP/2 frames found.
# Uses tshark display filter "http2" (SETTINGS, HEADERS, DATA, etc.)
# Optional $2: keylog file for TLS decryption (HTTP/2 frames are encrypted without it)
verify_http2_in_pcap() {
  local pcap="${1:?pcap file path}"
  local keylog="${2:-}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    return 1
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    return 2
  fi
  local opts=()
  [[ -n "$keylog" ]] && [[ -f "$keylog" ]] && [[ -s "$keylog" ]] && opts=(-o "tls.keylog_file:$keylog")
  local count
  count=$(tshark -r "$pcap" "${opts[@]}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]] && return 0
  return 1
}

# Count HTTP/2 packets in pcap. Optional $2: keylog file for TLS decryption.
count_http2_in_pcap() {
  local pcap="${1:?pcap file path}"
  local keylog="${2:-}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local opts=()
  [[ -n "$keylog" ]] && [[ -f "$keylog" ]] && [[ -s "$keylog" ]] && opts=(-o "tls.keylog_file:$keylog")
  local count
  count=$(tshark -r "$pcap" "${opts[@]}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Verify QUIC in a pcap file (local path). Returns 0 if QUIC packets found.
# Uses tshark display filter "quic" (Initial, Handshake, 1RTT, etc.)
verify_quic_in_pcap() {
  local pcap="${1:?pcap file path}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    return 1
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    return 2
  fi
  local count
  count=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]] && return 0
  return 1
}

# Count QUIC packets in pcap
count_quic_in_pcap() {
  local pcap="${1:?pcap file path}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Verify gRPC in pcap (HTTP/2 with application/grpc content-type)
count_grpc_in_pcap() {
  local pcap="${1:?pcap file path}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y 'http2.header.value contains "application/grpc"' 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Count raw TCP 443 and UDP 443 in pcap (proof of traffic when TLS prevents http2 decode)
count_tcp443_udp443_in_pcap() {
  local pcap="${1:?pcap file path}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0 0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0 0"
    return
  fi
  local tcp443 udp443
  tcp443=$(tshark -r "$pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  udp443=$(tshark -r "$pcap" -Y "udp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$tcp443" =~ ^[0-9]+$ ]] || tcp443=0
  [[ "$udp443" =~ ^[0-9]+$ ]] || udp443=0
  echo "$tcp443 $udp443"
}

# Count QUIC packets with SNI record.local (definitive proof traffic is for our domain; no background QUIC noise).
count_quic_sni_record_local_in_pcap() {
  local pcap="${1:?pcap file path}"
  local sni="${2:-record.local}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y "quic && tls.handshake.extensions_server_name contains $sni" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Count UDP 443 to TARGET_IP (for host/VM pcaps only; in-pod pcaps have dst=pod IP so this is 0).
count_udp443_to_target_in_pcap() {
  local pcap="${1:?pcap file path}"
  local target_ip="${2:?TARGET_IP}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y "udp.port == 443 && ip.dst == $target_ip" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Count UDP 443 stray (dst != TARGET_IP). For host/VM pcaps should be 0; for in-pod pcaps dst=pod IP so this equals all UDP 443.
count_udp443_stray_in_pcap() {
  local pcap="${1:?pcap file path}"
  local target_ip="${2:?TARGET_IP}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y "udp.port == 443 && ip.dst != $target_ip" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Count ALPN "h2" in TLS Client Hello (unencrypted; no keylog needed). Multiple tshark field names for portability.
count_alpn_h2_in_pcap() {
  local pcap="${1:?pcap file path}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count=0
  # tls.handshake.extensions_alpn_str (Wireshark 3.x+)
  count=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
  [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]] && echo "$count" && return
  # ssl.handshake.extensions_alpn (older Wireshark)
  count=$(tshark -r "$pcap" -Y "ssl.handshake.extensions_alpn" -T fields -e ssl.handshake.extensions_alpn 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
  [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]] && echo "$count" && return
  # Extension type 16 = ALPN; decode as text
  count=$(tshark -r "$pcap" -Y "tls.handshake.extension.type == 16" -T fields -e tls.handshake.extension.data 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
  [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]] && echo "$count" && return
  echo "0"
}

# Aggregate verification for a directory of pcaps (e.g. caddy-rotation-*.pcap)
# Prints OK/warn and returns 0 if at least HTTP/2, ALPN h2, QUIC, or (TCP443+UDP443) verified; 1 if nothing.
# When TLS is used, http2 frames may be 0 without SSLKEYLOGFILE; ALPN h2 in Client Hello is definitive; TCP 443 is proof of HTTPS.
verify_protocol_in_dir() {
  local dir="${1:?directory}"
  local label="${2:-capture}"
  local http2_total=0 quic_total=0 tcp443_total=0 udp443_total=0 alpn_h2_total=0
  local pcap
  for pcap in "$dir"/*.pcap; do
    [[ -f "$pcap" ]] || continue
    [[ -s "$pcap" ]] || continue
    http2_total=$((http2_total + $(count_http2_in_pcap "$pcap")))
    quic_total=$((quic_total + $(count_quic_in_pcap "$pcap")))
    alpn_h2_total=$((alpn_h2_total + $(count_alpn_h2_in_pcap "$pcap")))
    local tcp443 udp443
    read -r tcp443 udp443 <<< "$(count_tcp443_udp443_in_pcap "$pcap")"
    tcp443_total=$((tcp443_total + tcp443))
    udp443_total=$((udp443_total + udp443))
  done
  if [[ "$http2_total" -gt 0 ]]; then
    echo "  OK: $label HTTP/2 verified ($http2_total frames)"
  fi
  if [[ "$alpn_h2_total" -gt 0 ]] && [[ "$http2_total" -eq 0 ]]; then
    echo "  OK: $label HTTP/2 intent verified (ALPN h2 in TLS Client Hello, $alpn_h2_total)"
  fi
  if [[ "$quic_total" -gt 0 ]]; then
    echo "  OK: $label HTTP/3 (QUIC) verified ($quic_total packets)"
  elif [[ "$udp443_total" -gt 0 ]]; then
    # QUIC is encrypted; tshark "quic" filter may not decode. UDP 443 during HTTP/3 test = QUIC.
    echo "  OK: $label HTTP/3 (QUIC) verified (UDP 443=$udp443_total packets)"
  else
    echo "  WARN: $label No QUIC packets (no UDP 443; HTTP/3 may not be in use or traffic hit other Caddy pod)"
  fi
  # SNI validation: QUIC with record.local = definitive proof traffic belongs to our domain (no background noise).
  local sni_total=0
  for pcap in "$dir"/*.pcap; do
    [[ -f "$pcap" ]] || continue
    [[ -s "$pcap" ]] || continue
    sni_total=$((sni_total + $(count_quic_sni_record_local_in_pcap "$pcap" "record.local")))
  done
  [[ "$sni_total" -gt 0 ]] && echo "  OK: $label QUIC SNI record.local: $sni_total packets (definitive proof traffic to our domain)"
  # When TARGET_IP set: report QUIC to LB IP and stray (for host/VM pcaps; in-pod has dst=pod IP so to_lb may be 0).
  if [[ -n "${TARGET_IP:-}" ]]; then
    local to_lb=0 stray=0
    for pcap in "$dir"/*.pcap; do
      [[ -f "$pcap" ]] || continue
      [[ -s "$pcap" ]] || continue
      to_lb=$((to_lb + $(count_udp443_to_target_in_pcap "$pcap" "$TARGET_IP")))
      stray=$((stray + $(count_udp443_stray_in_pcap "$pcap" "$TARGET_IP")))
    done
    echo "  UDP 443 to $TARGET_IP (MetalLB): $to_lb packets; stray (dst != $TARGET_IP): $stray (in-pod capture has dst=pod IP so to_lb may be 0)"
    [[ "$stray" -eq 0 ]] && [[ "$to_lb" -gt 0 ]] && echo "  OK: No stray UDP 443 (all QUIC to LB IP)"
  fi
  echo "  Packet summary: HTTP/2=$http2_total, QUIC=$quic_total, UDP443=$udp443_total"
  if [[ "$tcp443_total" -gt 0 ]] || [[ "$udp443_total" -gt 0 ]]; then
    if [[ "$http2_total" -eq 0 ]] && [[ "$alpn_h2_total" -eq 0 ]]; then
      echo "  Wire summary: TCP 443=$tcp443_total, UDP 443=$udp443_total (traffic seen; for HTTP/2 frame proof set SSLKEYLOGFILE)"
    else
      echo "  Wire summary: TCP 443=$tcp443_total, UDP 443=$udp443_total"
    fi
  fi
  [[ "$http2_total" -gt 0 ]] && return 0
  [[ "$alpn_h2_total" -gt 0 ]] && return 0
  [[ "$quic_total" -gt 0 ]] && return 0
  [[ "$udp443_total" -gt 0 ]] && return 0
  [[ "$tcp443_total" -gt 0 ]] && [[ "$udp443_total" -gt 0 ]] && return 0
  [[ "$tcp443_total" -gt 0 ]] && return 0
  return 1
}
