#!/usr/bin/env python3
"""
Transport verification: QUIC presence, version, ALPN, packet-level stats,
loss approximation, handshake RTT, retry detection, proof hash, confidence score.
No STREAM/short-header required for basic valid (encrypted in 1-RTT); optional 1-RTT minimum for CI.
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

# Cap packets for count passes (avoid scanning 5GB pcaps)
MAX_PACKETS = 5000


def run(cmd, timeout=30):
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def tshark_bin():
    return os.environ.get("TSHARK_BIN", "").strip() or "tshark"


def main():
    args = sys.argv[1:]
    if not args:
        out = {"valid": False, "error": "no pcap provided"}
        print(json.dumps(out), flush=True)
        sys.exit(2)

    pcap = args[0]
    out_path = None
    if "--output" in args:
        i = args.index("--output")
        if i + 1 < len(args):
            out_path = args[i + 1]

    tshark = tshark_bin()
    pcap_path = Path(pcap)
    if not pcap_path.exists():
        result = {"valid": False, "error": "pcap file not found", "quic_version": None}
        if out_path:
            Path(out_path).write_text(json.dumps(result))
        print(json.dumps(result), flush=True)
        sys.exit(2)

    # 1. Detect QUIC presence
    r = run([tshark, "-r", pcap, "-Y", "quic", "-c", "1"])
    quic_detected = r.returncode == 0 and bool((r.stdout or "").strip())

    # 2. Extract QUIC version
    version = None
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "quic.version", "-Y", "quic", "-c", "5"])
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            line = line.strip()
            if line:
                version = line
                break

    # 3. Detect HTTP/2 fallback
    r = run([tshark, "-r", pcap, "-Y", "http2", "-c", "1"])
    http2_detected = r.returncode == 0 and bool((r.stdout or "").strip())

    # 4. Count total QUIC packets
    r = run([tshark, "-r", pcap, "-Y", "quic", "-T", "fields", "-e", "frame.number", "-c", str(MAX_PACKETS)])
    quic_packets = len([x for x in (r.stdout or "").splitlines() if x.strip()]) if r.returncode == 0 else 0

    # 5. Count 1-RTT packets (short header)
    r = run([tshark, "-r", pcap, "-Y", "quic.header_form == 0", "-T", "fields", "-e", "frame.number", "-c", str(MAX_PACKETS)])
    quic_1rtt_packets = len([x for x in (r.stdout or "").splitlines() if x.strip()]) if r.returncode == 0 else 0

    # 6. Count Initial packets
    r = run([tshark, "-r", pcap, "-Y", "quic.long.packet_type == 0", "-T", "fields", "-e", "frame.number", "-c", str(MAX_PACKETS)])
    quic_initial_packets = len([x for x in (r.stdout or "").splitlines() if x.strip()]) if r.returncode == 0 else 0

    # 7. ALPN from TLS ClientHello (inside QUIC)
    alpn_protocol = None
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "tls.handshake.extensions_alpn_str", "-Y", "tls.handshake.type == 1", "-c", "20"])
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            line = (line or "").strip()
            if line and "h3" in line:
                alpn_protocol = line
                break
    alpn_h3 = bool(alpn_protocol and "h3" in alpn_protocol)

    # 8. Transport proof hash (chunked read for large pcaps)
    transport_proof_sha256 = None
    try:
        h = hashlib.sha256()
        with open(pcap_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        transport_proof_sha256 = h.hexdigest()
    except OSError:
        pass

    # 9. QUIC loss approximation (packet number gaps; long-header only)
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "quic.packet_number", "-Y", "quic.packet_number", "-c", str(MAX_PACKETS)])
    packet_numbers = []
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            try:
                packet_numbers.append(int(line.strip()))
            except (ValueError, TypeError):
                pass
    packet_numbers = sorted(set(packet_numbers))
    quic_loss_estimated = 0
    quic_loss_rate_estimated = 0.0
    if len(packet_numbers) > 1:
        expected = packet_numbers[-1] - packet_numbers[0] + 1
        lost = max(0, expected - len(packet_numbers))
        quic_loss_estimated = lost
        quic_loss_rate_estimated = round(lost / expected, 6) if expected else 0.0

    # 10. Handshake RTT: earliest Initial → earliest 1-RTT timestamp (multiple packets so we get real first)
    handshake_rtt_ms_estimated = None
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "frame.time_epoch", "-Y", "quic.long.packet_type == 0", "-c", "50"])
    initial_timestamps = []
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            try:
                initial_timestamps.append(float(line.strip()))
            except (ValueError, TypeError):
                pass
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "frame.time_epoch", "-Y", "quic.header_form == 0", "-c", "50"])
    onertt_timestamps = []
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            try:
                onertt_timestamps.append(float(line.strip()))
            except (ValueError, TypeError):
                pass
    if initial_timestamps and onertt_timestamps:
        t0 = min(initial_timestamps)
        # First 1-RTT at or after first Initial
        t1_candidates = [t for t in onertt_timestamps if t >= t0]
        if t1_candidates:
            t1 = min(t1_candidates)
            handshake_rtt_ms_estimated = round((t1 - t0) * 1000, 3)

    # 11. Retry detection
    r = run([tshark, "-r", pcap, "-Y", "quic.long.packet_type == 3", "-c", "1"])
    quic_retry_detected = r.returncode == 0 and bool((r.stdout or "").strip())

    # 12. Packet size distribution
    r = run([tshark, "-r", pcap, "-T", "fields", "-e", "frame.len", "-Y", "quic", "-c", str(MAX_PACKETS)])
    sizes = []
    if r.returncode == 0 and r.stdout:
        for line in (r.stdout or "").splitlines():
            try:
                sizes.append(int(line.strip()))
            except (ValueError, TypeError):
                pass
    quic_packet_size_stats = {}
    if sizes:
        quic_packet_size_stats = {
            "min": min(sizes),
            "max": max(sizes),
            "avg": round(sum(sizes) / len(sizes), 2),
        }

    # 13. Transport confidence score (0–100) and transparent breakdown
    confidence_breakdown = {
        "quic_detected": 25 if quic_detected else 0,
        "version_detected": 10 if version else 0,
        "no_http2_fallback": 10 if not http2_detected else 0,
        "1rtt_data_phase": 20 if (quic_1rtt_packets and quic_1rtt_packets > 10) else 0,
        "low_loss": 15 if quic_loss_rate_estimated < 0.02 else 0,
        "no_retry": 10 if not quic_retry_detected else 0,
        "fast_handshake": 10 if (handshake_rtt_ms_estimated is not None and handshake_rtt_ms_estimated < 100) else 0,
    }
    transport_confidence_score = min(sum(confidence_breakdown.values()), 100)
    if transport_confidence_score is None:
        transport_confidence_score = 0

    # Valid: QUIC + no HTTP/2; CI gate: require sustained data phase (≥10 1-RTT)
    valid = bool(quic_detected and not http2_detected)
    error = None
    if not quic_detected:
        error = "no QUIC packets"
    elif http2_detected:
        error = "HTTP/2 frames detected"
    elif quic_1rtt_packets is not None and quic_1rtt_packets < 10:
        valid = False
        error = "Insufficient 1-RTT packets (no sustained data phase)"
        if transport_confidence_score > 0:
            transport_confidence_score = max(0, transport_confidence_score - 20)
            confidence_breakdown["1rtt_data_phase"] = 0

    result = {
        "valid": valid,
        "error": error,
        "quic_version": version,
        "alpn_h3": alpn_h3,
        "alpn_protocol": alpn_protocol,
        "http2_frames": 1 if http2_detected else 0,
        "http2_detected": http2_detected,
        "quic_packet_count": quic_packets,
        "quic_1rtt_packets": quic_1rtt_packets,
        "quic_initial_packets": quic_initial_packets,
        "quic_loss_estimated": quic_loss_estimated,
        "quic_loss_rate_estimated": quic_loss_rate_estimated,
        "handshake_rtt_ms_estimated": handshake_rtt_ms_estimated,
        "quic_retry_detected": quic_retry_detected,
        "quic_packet_size_stats": quic_packet_size_stats if quic_packet_size_stats else None,
        "transport_proof_sha256": transport_proof_sha256,
        "transport_confidence_score": transport_confidence_score,
        "transport_confidence_breakdown": confidence_breakdown,
    }
    if out_path:
        Path(out_path).write_text(json.dumps(result))
    print(json.dumps(result), flush=True)
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
