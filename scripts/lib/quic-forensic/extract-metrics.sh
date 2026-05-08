#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCAP="${1:-}"
KEYLOG="${2:-}"

if [[ -z "$PCAP" ]]; then
  echo '{"valid":false,"error":"pcap path required"}'
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"valid":false,"error":"jq not installed"}'
  exit 2
fi

analyzer="${QUIC_FORENSIC_ANALYZER:-$SCRIPT_DIR/analyze-quic-v6.sh}"
if [[ ! -x "$analyzer" ]]; then
  analyzer="$SCRIPT_DIR/analyze-quic-v5.sh"
fi
if [[ ! -x "$analyzer" ]]; then
  analyzer="$SCRIPT_DIR/analyze-quic.sh"
fi

"$analyzer" "$PCAP" "$KEYLOG" | jq '{
  valid,
  quic_frame_count,
  quic_versions,
  handshake,
  packet_number_spaces,
  header_protection_signal,
  loss_signal,
  zero_rtt,
  tls: {selected_cipher_suite: .tls.selected_cipher_suite, certificate_sha256: .tls.certificate_sha256},
  rtt_signal,
  connection_id,
  key_update,
  spin_bit_rtt_estimate_seconds,
  congestion_signal,
  version_negotiation_packets
}'
