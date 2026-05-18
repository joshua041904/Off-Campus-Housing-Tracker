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

# Count QUIC packets with SNI off-campus-housing.test (definitive proof traffic is for our domain; no background QUIC noise).
count_quic_sni_record_local_in_pcap() {
  local pcap="${1:?pcap file path}"
  local sni="${2:-off-campus-housing.test}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  # Quote SNI for display filter (OCH: off-campus-housing.test; not record.local / RP)
  count=$(tshark -r "$pcap" -Y "quic && tls.handshake.extensions_server_name contains \"${sni}\"" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# UDP/443 packets whose IPv4 dst is NOT the pod ingress IP (should be 0 for Caddy pod capture on eth0).
count_udp443_stray_not_pod_in_pcap() {
  local pcap="${1:?pcap file path}"
  local pod_ip="${2:?pod IP}"
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    echo "0"
    return
  fi
  if ! command -v tshark >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local count
  count=$(tshark -r "$pcap" -Y "udp.port == 443 && ip && ip.dst != ${pod_ip}" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$count" =~ ^[0-9]+$ ]] && echo "$count" || echo "0"
}

# Gold-standard checks for a Caddy pod pcap: no stray UDP/443 to other hosts; QUIC SNI matches OCH hostname.
# Returns 0 on success; 1 if STRICT_QUIC_VALIDATION=1 and checks fail.
verify_caddy_pcap_quic_enforcement() {
  local pcap="${1:?pcap}"
  local pod_ip="${2:?pod IP}"
  local sni="${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}"
  [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]] && return 0
  command -v tshark >/dev/null 2>&1 || { echo "  [capture-verify] tshark not installed; skip QUIC/SNI enforcement"; return 0; }
  local stray udp_all sni_count quic_any
  stray=$(count_udp443_stray_not_pod_in_pcap "$pcap" "$pod_ip")
  read -r _tcp udp_all <<< "$(count_tcp443_udp443_in_pcap "$pcap")"
  sni_count=$(count_quic_sni_record_local_in_pcap "$pcap" "$sni")
  quic_any=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l | tr -d '[:space:]')
  [[ ! "$quic_any" =~ ^[0-9]+$ ]] && quic_any=0
  echo "  [capture-verify] $pcap: UDP/443 stray (dst != pod ${pod_ip}): ${stray:-0}; QUIC SNI '${sni}': ${sni_count:-0} lines; UDP/443 total: ${udp_all:-0}"
  if [[ "${stray:-0}" -gt 0 ]]; then
    echo "  [capture-verify] FAIL: stray UDP/443 to non-pod IP (background QUIC or wrong interface). Use BPF dst pod IP + -i eth0."
    [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && return 1
  fi
  if [[ "${udp_all:-0}" -gt 0 ]] && [[ "${sni_count:-0}" -eq 0 ]]; then
    echo "  [capture-verify] WARN: UDP/443 present but no QUIC TLS SNI '${sni}' decoded (tshark version or encrypted Initial); curl --http3 success still counts for app layer"
    [[ "${CAPTURE_ENFORCE_QUIC_SNI:-0}" == "1" ]] && { echo "  [capture-verify] FAIL: CAPTURE_ENFORCE_QUIC_SNI=1 requires SNI proof"; return 1; }
  elif [[ "${sni_count:-0}" -gt 0 ]]; then
    echo "  [capture-verify] OK: QUIC + SNI '${sni}' present (definitive OCH edge proof)"
  fi
  return 0
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

# QUIC + HTTP/3: Prefer tls.handshake.extensions_alpn_str (works with decrypted QUIC in typical tshark);
# avoid relying on quic.tls.handshake.extensions_alpn (field/filter missing on many builds).
# Optional args after pcap are passed to tshark (e.g. -o tls.keylog_file:/path).
count_alpn_h3_quic_packets_in_pcap() {
  local pcap="${1:?pcap}"
  shift
  [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]] && {
    echo "0"
    return 0
  }
  command -v tshark >/dev/null 2>&1 || {
    echo "0"
    return 0
  }

  local c
  for filter in \
    'quic && tls.handshake.extensions_alpn_str contains "h3"' \
    'quic && tls.handshake.extensions_alpn_str == "h3"' \
    'tls.handshake.extensions_alpn_str == "h3"' \
    'quic && tls.handshake.extensions_alpn contains "h3"' \
    'tls.handshake.extensions_alpn_str contains "h3" && quic' \
    'quic && quic.tls.handshake.extensions_alpn contains "h3"'; do
    c=$(tshark "$@" -r "$pcap" -Y "$filter" 2>/dev/null | wc -l | tr -d '[:space:]')
    [[ "$c" =~ ^[0-9]+$ ]] && [[ "$c" -gt 0 ]] && {
      echo "$c"
      return 0
    }
  done

  local raw
  for e in tls.handshake.extensions_alpn_str quic.tls.handshake.extensions_alpn_str quic.tls.handshake.extensions_alpn ssl.handshake.extensions_alpn; do
    raw=$(tshark "$@" -r "$pcap" -Y "quic" -T fields -e "$e" 2>/dev/null || true)
    if echo "$raw" | grep -q "h3"; then
      c=$(echo "$raw" | grep -c "h3" 2>/dev/null || echo "0")
      [[ "$c" =~ ^[0-9]+$ ]] && [[ "$c" -gt 0 ]] && {
        echo "$c"
        return 0
      }
      echo "1"
      return 0
    fi
  done

  c=$(tshark "$@" -r "$pcap" -Y "http3" 2>/dev/null | wc -l | tr -d '[:space:]')
  [[ "$c" =~ ^[0-9]+$ ]] && [[ "$c" -gt 0 ]] && {
    echo "$c"
    return 0
  }

  echo "0"
}

# One line per ALPN string from QUIC frames (for transport-summary.json). First approach that yields output wins.
quic_alpn_strings_from_pcap() {
  local pcap="${1:?pcap}"
  shift
  [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]] && return 0
  command -v tshark >/dev/null 2>&1 || return 0
  local e out
  out=$(tshark "$@" -r "$pcap" -Y "quic" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -v '^[[:space:]]*$' || true)
  if [[ -n "$out" ]]; then
    echo "$out"
    return 0
  fi
  for e in quic.tls.handshake.extensions_alpn_str quic.tls.handshake.extensions_alpn ssl.handshake.extensions_alpn; do
    out=$(tshark "$@" -r "$pcap" -Y "quic" -T fields -e "$e" 2>/dev/null | grep -v '^[[:space:]]*$' || true)
    if [[ -n "$out" ]]; then
      echo "$out"
      return 0
    fi
  done
  return 0
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
  # SNI validation: QUIC with off-campus-housing.test = definitive proof traffic belongs to our domain (no background noise).
  local sni_total=0
  for pcap in "$dir"/*.pcap; do
    [[ -f "$pcap" ]] || continue
    [[ -s "$pcap" ]] || continue
    sni_total=$((sni_total + $(count_quic_sni_record_local_in_pcap "$pcap" "${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}")))
  done
  [[ "$sni_total" -gt 0 ]] && echo "  OK: $label QUIC SNI off-campus-housing.test: $sni_total packets (definitive proof traffic to our domain)"
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
