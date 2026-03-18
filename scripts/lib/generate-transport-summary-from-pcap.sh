#!/usr/bin/env bash
# Generate transport-summary.json from a single node-level pcap (e.g. from rotation wire capture).
# Usage: generate-transport-summary-from-pcap.sh <node.pcap> [run_type]
#   run_type = baseline | rotation (default: rotation). Writes to TRANSPORT_CAPTURES_DIR/$run_type/transport-summary.json
# Requires: tshark, python3, scripts/lib/analyze_tls_timing.py
# Use when rotation suite has a node pcap and you want to produce rotation/transport-summary.json for transport-diff.
set -euo pipefail
NODE_PCAP="${1:?Usage: $0 <node.pcap> [run_type]}"
RUN_TYPE="${2:-rotation}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURES_ROOT="${TRANSPORT_CAPTURES_DIR:-/tmp/transport-captures}"
OUT_DIR="$CAPTURES_ROOT/$RUN_TYPE"
mkdir -p "$OUT_DIR"
SUMMARY_FILE="$OUT_DIR/transport-summary.json"

if [[ ! -f "$NODE_PCAP" ]] || [[ ! -s "$NODE_PCAP" ]]; then
  echo "Error: pcap missing or empty: $NODE_PCAP" >&2
  exit 1
fi
if ! command -v tshark >/dev/null 2>&1; then
  echo "Error: tshark required" >&2
  exit 1
fi

tcp_443=$(tcpdump -r "$NODE_PCAP" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
udp_443=$(tcpdump -r "$NODE_PCAP" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
tcp_443=${tcp_443:-0}
udp_443=${udp_443:-0}

quic_versions_json="{}"
quic_raw=$(tshark -r "$NODE_PCAP" -Y quic -T fields -e quic.version 2>/dev/null | sort | uniq -c || true)
if [[ -n "$quic_raw" ]]; then
  versions=""
  while read -r count ver; do
    [[ -z "$ver" ]] && continue
    ver="${ver//\"/}"
    versions="${versions}\"${ver}\": ${count},"
  done <<< "$quic_raw"
  versions="${versions%,}"
  [[ -n "$versions" ]] && quic_versions_json="{$versions}"
fi

alpn_tls_json="{}"
alpn_tls_raw=$(tshark -r "$NODE_PCAP" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
if [[ -n "$alpn_tls_raw" ]]; then
  alpn_tls_pairs=""
  while read -r count alpn; do
    [[ -z "$alpn" ]] && continue
    alpn="${alpn//\"/}"
    alpn_tls_pairs="${alpn_tls_pairs}\"${alpn}\": ${count},"
  done <<< "$alpn_tls_raw"
  alpn_tls_pairs="${alpn_tls_pairs%,}"
  [[ -n "$alpn_tls_pairs" ]] && alpn_tls_json="{$alpn_tls_pairs}"
fi

alpn_quic_json="{}"
alpn_quic_raw=$(tshark -r "$NODE_PCAP" -Y "quic.tls.handshake.extensions_alpn" -T fields -e quic.tls.handshake.extensions_alpn 2>/dev/null | sort | uniq -c || true)
[[ -z "$alpn_quic_raw" ]] && alpn_quic_raw=$(tshark -r "$NODE_PCAP" -Y "quic" -T fields -e quic.tls.handshake.extensions_alpn_str 2>/dev/null | sort | uniq -c || true)
if [[ -n "$alpn_quic_raw" ]]; then
  alpn_quic_pairs=""
  while read -r count alpn; do
    [[ -z "$alpn" ]] && continue
    alpn="${alpn//\"/}"
    alpn_quic_pairs="${alpn_quic_pairs}\"${alpn}\": ${count},"
  done <<< "$alpn_quic_raw"
  alpn_quic_pairs="${alpn_quic_pairs%,}"
  [[ -n "$alpn_quic_pairs" ]] && alpn_quic_json="{$alpn_quic_pairs}"
fi

tls_timing_json='{"avg":0,"p50":0,"p95":0,"max":0}'
tls_handshake_file="$(mktemp)"
if tshark -r "$NODE_PCAP" -Y "tls.handshake.type==1 || tls.handshake.type==2" -T fields -e frame.time_epoch -e tls.handshake.type -e tls.stream 2>/dev/null > "$tls_handshake_file"; then
  if [[ -f "$SCRIPT_DIR/analyze_tls_timing.py" ]]; then
    tls_out=$(python3 "$SCRIPT_DIR/analyze_tls_timing.py" "$tls_handshake_file" 2>/dev/null || echo "")
    if [[ -n "$tls_out" ]]; then
      tls_timing_json=$(echo "$tls_out" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tls_handshake_ms',{'avg':0,'p50':0,'p95':0,'max':0})))" 2>/dev/null || echo '{"avg":0,"p50":0,"p95":0,"max":0}')
    fi
  fi
fi
rm -f "$tls_handshake_file"

cat > "$SUMMARY_FILE" << TRANSPORT_JSON
{
  "tcp_443": $tcp_443,
  "udp_443": $udp_443,
  "quic_versions": $quic_versions_json,
  "alpn_tls": $alpn_tls_json,
  "alpn_quic": $alpn_quic_json,
  "tls_handshake_ms": $tls_timing_json
}
TRANSPORT_JSON
echo "Wrote $SUMMARY_FILE (run_type=$RUN_TYPE)"
# Run diff if both baseline and rotation exist
if [[ -f "$CAPTURES_ROOT/baseline/transport-summary.json" ]] && [[ -f "$CAPTURES_ROOT/rotation/transport-summary.json" ]]; then
  python3 "$SCRIPT_DIR/transport-diff.py" "$CAPTURES_ROOT" 2>/dev/null || true
fi
