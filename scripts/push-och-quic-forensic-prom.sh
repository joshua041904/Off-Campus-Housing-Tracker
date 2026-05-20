#!/usr/bin/env bash
# Push QUIC forensic summary gauges to Pushgateway (reads transport-summary-v7.json + optional v6 + pcap UDP count).
# Usage: bash scripts/push-och-quic-forensic-prom.sh <capture_dir> [keylog_file]
# Env: OCH_PUSHGATEWAY_JOB=quic-forensic OCH_PUSHGATEWAY_INSTANCE=… (optional)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${1:-}"
KEYLOG="${2:-}"
[[ -n "$DIR" && -d "$DIR" ]] || { echo "usage: $0 <capture_dir> [keylog]" >&2; exit 2; }
V7="$DIR/transport-summary-v7.json"
V6="$DIR/transport-summary-v6.json"
PCAP="$DIR/caddy-capture.pcap"
# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"
RUN_ID="$(och_read_run_id "$ROOT")"

v6_valid=0
v6_frames=0
v6_alpn=0
if [[ -f "$V6" ]]; then
  v6_valid="$(jq -r 'if .valid == true then 1 else 0 end' "$V6" 2>/dev/null || echo 0)"
  v6_frames="$(jq -r '.quic_frame_count // 0' "$V6" 2>/dev/null || echo 0)"
fi

v7_valid=0
v7_frames=0
v7_alpn=0
v7_1rtt=0
if [[ -f "$V7" ]]; then
  v7_valid="$(jq -r 'if .valid == true then 1 else 0 end' "$V7" 2>/dev/null || echo 0)"
  v7_frames="$(jq -r '.quic.frame_count // 0' "$V7" 2>/dev/null || echo 0)"
  v7_alpn="$(jq -r 'if .tls.alpn_protocol == "h3" then 1 else 0 end' "$V7" 2>/dev/null || echo 0)"
  v7_1rtt="$(jq -r 'if ([.quic.packet_number_spaces[]? | select(.space == "1RTT")] | length) > 0 then 1 else 0 end' "$V7" 2>/dev/null || echo 0)"
fi

udp_count=0
if [[ -f "$PCAP" ]] && command -v tshark >/dev/null 2>&1; then
  udp_count="$(tshark -r "$PCAP" -Y "udp.port == 443" -T fields -e frame.number 2>/dev/null | wc -l | tr -d '[:space:]' || echo 0)"
fi

prom="$ROOT/bench_logs/och-quic-forensic.prom"
mkdir -p "$(dirname "$prom")"
cat >"$prom" <<EOF
# HELP och_quic_forensic_valid 1 when transport summary JSON marked valid.
# TYPE och_quic_forensic_valid gauge
och_quic_forensic_valid{version="v6",run_id="${RUN_ID}"} ${v6_valid}
och_quic_forensic_valid{version="v7",run_id="${RUN_ID}"} ${v7_valid}
# HELP och_quic_frame_count QUIC frames decoded in summary.
# TYPE och_quic_frame_count gauge
och_quic_frame_count{version="v6",run_id="${RUN_ID}"} ${v6_frames}
och_quic_frame_count{version="v7",run_id="${RUN_ID}"} ${v7_frames}
# HELP och_quic_alpn_h3_seen 1 when TLS ALPN h3 present in summary.
# TYPE och_quic_alpn_h3_seen gauge
och_quic_alpn_h3_seen{version="v6",run_id="${RUN_ID}"} ${v6_alpn}
och_quic_alpn_h3_seen{version="v7",run_id="${RUN_ID}"} ${v7_alpn}
# HELP och_quic_1rtt_present 1 when 1-RTT packet space seen (v7 summary).
# TYPE och_quic_1rtt_present gauge
och_quic_1rtt_present{version="v7",run_id="${RUN_ID}"} ${v7_1rtt}
# HELP och_quic_udp443_packet_count UDP/443 frames in capture pcap (best-effort).
# TYPE och_quic_udp443_packet_count gauge
och_quic_udp443_packet_count{run_id="${RUN_ID}"} ${udp_count}
EOF

chmod +x "$ROOT/scripts/lib/push-och-prom.sh" 2>/dev/null || true
OCH_PUSHGATEWAY_JOB="${OCH_PUSHGATEWAY_JOB:-quic-forensic}" OCH_PUSHGATEWAY_INSTANCE="${OCH_PUSHGATEWAY_INSTANCE:-$RUN_ID}" \
  bash "$ROOT/scripts/lib/push-och-prom.sh" "$prom"
echo "Pushed QUIC forensic metrics (${RUN_ID})"
