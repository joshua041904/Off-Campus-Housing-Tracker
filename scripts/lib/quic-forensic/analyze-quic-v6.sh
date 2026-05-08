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

# ServerHello (type 2) selected cipher — not the ClientHello offer list.
selected_cipher_suite="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.type == 2' -T fields -e tls.handshake.ciphersuite 2>/dev/null | awk 'NF{print; exit}' || true)"
cert_fingerprint="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.certificate' -T fields -e x509af.sha256_fingerprint 2>/dev/null | awk 'NF{print; exit}' || true)"
[[ -z "${cert_fingerprint:-}" ]] && cert_fingerprint="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.certificate' -T fields -e x509af.sha256 2>/dev/null | awk 'NF{print; exit}' || true)"

# Display-filter fallbacks (JSON field shapes vary by tshark build): Initial / short-header 1-RTT / first ACK epoch.
_ts_init="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'quic && quic.long.packet_type == 0' -T fields -e frame.time_epoch 2>/dev/null | head -1 | tr -d '\r' || true)"
_ts_1rtt="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'quic && quic.packet_number && !quic.long.packet_type' -T fields -e frame.time_epoch 2>/dev/null | head -1 | tr -d '\r' || true)"
[[ -z "${_ts_1rtt:-}" ]] && _ts_1rtt="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'quic.short' -T fields -e frame.time_epoch 2>/dev/null | head -1 | tr -d '\r' || true)"
_ts_ack="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'quic && quic.ack.largest_acknowledged' -T fields -e frame.time_epoch 2>/dev/null | head -1 | tr -d '\r' || true)"

jq \
  --arg selected_cipher_suite "${selected_cipher_suite:-}" \
  --arg cert_fingerprint "${cert_fingerprint:-}" \
  --arg init_ov "${_ts_init:-}" \
  --arg onertt_ov "${_ts_1rtt:-}" \
  --arg ack_ov "${_ts_ack:-}" '
  def frame_time: (._source.layers.frame["frame.time_epoch"] // null);
  def quic_layer: (._source.layers.quic // {});
  def long_type_raw: (quic_layer["quic.long.packet_type"] // null);
  # tshark JSON may use string "0" / number 0 for Initial, etc.
  def long_type_norm: (long_type_raw | if . == null then null elif (.|type) == "number" then (.|tostring) elif (.|type) == "string" then . else (.|tostring) end);
  def quic_ver: (quic_layer["quic.version"] // null);
  def pnum: (quic_layer["quic.packet_number"] // null);
  def to_num_or_null: (try tonumber catch null);
  # Long header present with a non-null type (0=Initial, 1=0-RTT, 2=Handshake). Key may exist with null on short headers.
  def has_long_header_type: ((long_type_raw != null) and ((long_type_raw | tostring) != ""));

  . as $rows
  | ($rows | length) as $total
  | ($rows | map(select(long_type_norm == "0")) | first | frame_time) as $initial_time
  | ($rows | map(select(long_type_norm == "2")) | first | frame_time) as $handshake_time
  | ($rows
      | map(select((has_long_header_type | not) and (pnum != null) and ((pnum | tostring) != "")))
      | first
      | frame_time) as $one_rtt_time
  | ($rows
      | map(select((pnum | tostring) != ""))
      | map(pnum | tostring | to_num_or_null)
      | map(select(. != null))
      | sort) as $packet_numbers_sorted
  | ($rows
      | map(. as $row | $row._source.layers.quic // {} | . as $ql
        | (($ql["quic.long.packet_type"] // null) | if . == null then null elif (.|type) == "number" then (.|tostring) elif (.|type) == "string" then . else (.|tostring) end) as $ltn
        | {
            key: (
              if (($ql["quic.long.packet_type"] // null) == null) then "1RTT"
              elif ($ltn == null or $ltn == "") then "1RTT"
              else $ltn end
            ),
            val: 1
          })
      | group_by(.key)
      | map({space: .[0].key, count: (map(.val) | add)})) as $spaces
  | ($rows | map(quic_ver | tostring) | map(select(. != "")) | unique) as $versions
  | ($rows | map(select((quic_ver | tostring) == "0x00000000")) | length) as $vn_count
  | ($rows | map(select(long_type_norm == "1")) | length) as $zero_rtt_count
  | ($rows
      | map(select((quic_layer["quic.ack.largest_acknowledged"] // "") | tostring != ""))
      | map({time: (frame_time | to_num_or_null), largest: (quic_layer["quic.ack.largest_acknowledged"] | tostring)})
      | map(select(.time != null))) as $ack_points
  | ($rows
      | map(. as $row | $row._source.layers.quic // {} | select((.["quic.key_phase"] // "") | tostring != "") | .["quic.key_phase"] | tostring)) as $key_phases
  | ($rows
      | map(select((quic_layer["quic.dcid"] // "") | tostring != ""))
      | map(quic_layer["quic.dcid"] | tostring)
      | unique) as $dcids
  | ($rows
      | map(select((quic_layer["quic.spin_bit"] // "") | tostring != ""))
      | map({time: (frame_time | to_num_or_null), spin: (quic_layer["quic.spin_bit"] | tostring)})
      | map(select(.time != null))) as $spin_points
  | ($packet_numbers_sorted | length) as $pn_len
  | ($ack_points | length) as $ack_len
  | ($key_phases | length) as $kp_len
  | (if ($init_ov != "") then $init_ov elif ($initial_time != null) then ($initial_time | tostring) else null end) as $init_disp
  | (if ($onertt_ov != "") then $onertt_ov elif ($one_rtt_time != null) then ($one_rtt_time | tostring) else null end) as $onertt_disp
  | (if ($init_disp != null and $onertt_disp != null) then (($onertt_disp | tonumber) - ($init_disp | tonumber)) else null end) as $hs_dur
  | (if ($ack_ov != "" and $init_disp != null) then (($ack_ov | tonumber) - ($init_disp | tonumber))
    elif $ack_len > 1 then ($ack_points[1].time - $ack_points[0].time)
    elif ($initial_time != null and $ack_len > 0) then ($ack_points[0].time - ($initial_time | tonumber))
    else null
    end) as $rtt_est
  | {
      valid: true,
      quic_frame_count: $total,
      quic_versions: $versions,
      handshake: {
        initial_packet_time: $init_disp,
        handshake_packet_time: ($handshake_time // null),
        first_1rtt_packet_time: $onertt_disp,
        handshake_duration_seconds: $hs_dur
      },
      packet_number_spaces: $spaces,
      header_protection_signal: {
        packet_numbers_monotonic: (
          if $pn_len < 2 then true
          else ([range(1; $pn_len) as $i | ($packet_numbers_sorted[$i] >= $packet_numbers_sorted[$i - 1])] | all)
          end
        )
      },
      loss_signal: {
        estimated_missing_packet_numbers: (
          if $pn_len < 2 then 0
          else (
            reduce range(1; $pn_len) as $i (0;
              . + (if ($packet_numbers_sorted[$i] - $packet_numbers_sorted[$i - 1]) > 1
                   then ($packet_numbers_sorted[$i] - $packet_numbers_sorted[$i - 1] - 1)
                   else 0
                   end)
            )
          )
          end
        )
      },
      zero_rtt: {
        detected: ($zero_rtt_count > 0),
        packet_count: $zero_rtt_count
      },
      tls: {
        selected_cipher_suite: (if ($selected_cipher_suite | tostring) == "" then null else $selected_cipher_suite end),
        certificate_sha256: (if ($cert_fingerprint | tostring) == "" then null else $cert_fingerprint end)
      },
      rtt_signal: {
        estimated_seconds: $rtt_est
      },
      connection_id: {
        unique_destination_cids: ($dcids | length),
        rotation_detected: (($dcids | length) > 1)
      },
      key_update: {
        key_phase_transitions: (
          if $kp_len < 2 then 0
          else (
            reduce range(1; $kp_len) as $i (0;
              . + (if $key_phases[$i] != $key_phases[$i - 1] then 1 else 0 end)
            )
          )
          end
        )
      },
      spin_bit_rtt_estimate_seconds: (
        if ($spin_points | length) > 2
        then (($spin_points[2].time) - ($spin_points[0].time))
        else null
        end
      ),
      congestion_signal: {
        max_packets_in_flight_estimate: (
          if $ack_len == 0 then ($pn_len)
          else (
            reduce range(0; $ack_len) as $i (
              {max: 0, prev: 0};
              . as $state
              | ($ack_points[$i].largest | tonumber? // $state.prev) as $cur
              | {
                  max: (if ($cur - $state.prev) > $state.max then ($cur - $state.prev) else $state.max end),
                  prev: $cur
                }
            ) | .max
          )
          end
        )
      },
      version_negotiation_packets: $vn_count,
      forensic_mode: "tshark-json-v6"
    }
' "$tmp_json"
