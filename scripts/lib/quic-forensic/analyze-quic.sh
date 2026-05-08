#!/usr/bin/env bash
set -euo pipefail

PCAP="${1:-}"
KEYLOG="${2:-}"

if [[ -z "$PCAP" ]]; then
  echo '{"valid":false,"error":"pcap path required"}'
  exit 2
fi

if [[ ! -f "$PCAP" ]]; then
  echo '{"valid":false,"error":"pcap not found"}'
  exit 2
fi

if ! command -v tshark >/dev/null 2>&1; then
  echo '{"valid":false,"error":"tshark not installed"}'
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"valid":false,"error":"jq not installed"}'
  exit 2
fi

tls_args=()
if [[ -n "$KEYLOG" ]] && [[ -f "$KEYLOG" ]]; then
  tls_args=(-o "tls.keylog_file:${KEYLOG}")
fi

tmp_json="$(mktemp)"
trap 'rm -f "$tmp_json"' EXIT

if ! tshark "${tls_args[@]}" -r "$PCAP" -Y quic -T json >"$tmp_json" 2>/dev/null; then
  echo '{"valid":false,"error":"tshark decode failed"}'
  exit 1
fi

if [[ ! -s "$tmp_json" ]] || [[ "$(jq 'length' "$tmp_json" 2>/dev/null || echo 0)" == "0" ]]; then
  echo '{"valid":false,"error":"no quic frames"}'
  exit 1
fi

jq '
  def frame_time: (._source.layers.frame["frame.time_epoch"] // empty);
  def quic_layer: (._source.layers.quic // {});
  def long_type: (quic_layer["quic.long.packet_type"] // empty);
  def quic_ver: (quic_layer["quic.version"] // empty);
  def pnum: (quic_layer["quic.packet_number"] // empty);
  def to_num_or_null: (try tonumber catch null);

  . as $rows
  | ($rows | length) as $total
  | ($rows | map(select(long_type == "0")) | first | frame_time) as $initial_time
  | ($rows | map(select(long_type == "2")) | first | frame_time) as $handshake_time
  | ($rows | map(select((pnum | tostring) != "" and (long_type | tostring) == "")) | first | frame_time) as $one_rtt_time
  | ($rows
      | map(select((pnum | tostring) != ""))
      | map(pnum | tostring | to_num_or_null)
      | map(select(. != null))) as $packet_numbers
  | ($rows
      | map({
          key: (if (long_type | tostring) == "" then "1RTT" else (long_type | tostring) end),
          val: 1
        })
      | group_by(.key)
      | map({space: .[0].key, count: (map(.val) | add)})) as $spaces
  | ($rows
      | map(quic_ver | tostring)
      | map(select(. != ""))
      | unique) as $versions
  | ($rows
      | map(select((quic_ver | tostring) == "0x00000000"))
      | length) as $vn_count
  | ($packet_numbers | length) as $pn_len
  | {
      valid: true,
      quic_frame_count: $total,
      quic_versions: $versions,
      handshake: {
        initial_packet_time: ($initial_time // null),
        handshake_packet_time: ($handshake_time // null),
        first_1rtt_packet_time: ($one_rtt_time // null),
        handshake_duration_seconds: (
          if ($initial_time != null and $one_rtt_time != null)
          then (($one_rtt_time | tonumber) - ($initial_time | tonumber))
          else null
          end
        )
      },
      packet_number_spaces: $spaces,
      header_protection_signal: {
        packet_numbers_monotonic: (
          if $pn_len < 2 then true
          else (
            [range(1; $pn_len) as $i | ($packet_numbers[$i] >= $packet_numbers[$i - 1])]
            | all
          )
          end
        )
      },
      version_negotiation_packets: $vn_count,
      forensic_mode: "tshark-json"
    }
' "$tmp_json"
