"""Passive QUIC statistics from UDP/443 payloads (no TLS decrypt)."""

from __future__ import annotations

from .header import looks_like_quic_v1_short_header, parse_long_header
from .pcap_io import iter_udp_443_payloads

QUIC_VERSION_1 = 0x00000001


def analyze_pcap_dpkt(pcap_path: str) -> dict:
    quic_long = 0
    initial_packets = 0
    version_v1_seen = False
    short_like = 0
    udp_payloads = 0

    for payload in iter_udp_443_payloads(pcap_path):
        udp_payloads += 1
        if len(payload) < 1:
            continue
        if payload[0] & 0x80:
            quic_long += 1
            ph = parse_long_header(payload)
            if ph and ph.get("version") == QUIC_VERSION_1:
                version_v1_seen = True
            if ph and ph.get("is_initial"):
                initial_packets += 1
        elif looks_like_quic_v1_short_header(payload[:1]):
            short_like += 1

    return {
        "parser": "dpkt-passive",
        "udp_443_payloads": udp_payloads,
        "quic_long_header_packets": quic_long,
        "quic_initial_packets_estimated": initial_packets,
        "quic_version_v1_seen": version_v1_seen,
        "quic_short_header_like_packets": short_like,
        "quic_packet_count": quic_long + short_like,
        "http2_detected": False,
        "quic_1rtt_packets": short_like,
        "quic_initial_packets": initial_packets,
        "alpn_h3": None,
        "alpn_protocol": None,
        "quic_version": "0x00000001" if version_v1_seen else None,
        "valid": bool(
            quic_long + short_like > 0 and initial_packets > 0 and version_v1_seen and short_like > 0
        ),
        "error": None
        if (
            quic_long + short_like > 0
            and initial_packets > 0
            and version_v1_seen
            and short_like > 0
        )
        else (
            "dpkt passive: need QUIC Initial (v1), at least one short-header-like (1-RTT phase) packet; "
            "extend capture duration or use tshark path (transport_validator.py) for ALPN/TLS decode."
        ),
    }
