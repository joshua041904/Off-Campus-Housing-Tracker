#!/usr/bin/env python3
"""
Congestion control diff engine: compare two pcaps (e.g. BBR vs CUBIC run).
Extracts RTT estimate, loss rate, UDP volume, burst loss; computes delta; classifies bound.
"""
import json
import subprocess
import sys
from pathlib import Path

# Allow same-dir import when run from project root
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from quic_loss_analyzer import analyze as quic_loss_analyze


def run_tshark_count(pcap: Path, display_filter: str) -> int:
    try:
        cmd = ["tshark", "-r", str(pcap), "-Y", display_filter, "-T", "fields", "-e", "frame.number"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            return 0
        return len([l for l in (r.stdout or "").splitlines() if l.strip()])
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0


def estimate_rtt_from_delta(pcap: Path) -> float:
    """Use frame.time_delta for QUIC packets as rough RTT proxy (ms). tshark -e frame.time_delta."""
    try:
        cmd = [
            "tshark", "-r", str(pcap), "-Y", "quic",
            "-T", "fields", "-e", "frame.time_epoch", "-e", "frame.time_delta"
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not r.stdout:
            return 0.0
        deltas = []
        for line in (r.stdout or "").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[1].strip():
                try:
                    d = float(parts[1])
                    if 0 < d < 1:
                        deltas.append(d * 1000)
                except ValueError:
                    pass
        return (sum(deltas) / len(deltas)) if deltas else 0.0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0.0


def profile_pcap(pcap: Path) -> dict:
    loss = quic_loss_analyze(pcap)
    udp_443 = run_tshark_count(pcap, "udp.port == 443")
    tcp_443 = run_tshark_count(pcap, "tcp.port == 443")
    rtt_ms = estimate_rtt_from_delta(pcap)
    return {
        "avg_rtt_ms": round(rtt_ms, 2),
        "loss_rate_percent": loss.get("loss_rate_percent", 0),
        "burst_loss_events": loss.get("gap_events", 0) if loss.get("burst_loss_detected") else 0,
        "udp_packets": udp_443,
        "tcp_packets": tcp_443,
        "total_quic": loss.get("total_packets", 0),
    }


def classify_conclusion(bbr: dict, cubic: dict) -> str:
    rtt_b = bbr.get("avg_rtt_ms") or 0
    rtt_c = cubic.get("avg_rtt_ms") or 0
    loss_b = bbr.get("loss_rate_percent") or 0
    loss_c = cubic.get("loss_rate_percent") or 0
    if rtt_b <= 0 and rtt_c <= 0 and loss_b < 0.1 and loss_c < 0.1:
        return "cpu_bound_not_transport"
    if rtt_b > 0 and rtt_c > 0:
        rtt_delta = (rtt_c - rtt_b) / rtt_b * 100 if rtt_b else 0
        if -15 <= rtt_delta <= 15 and abs(loss_c - loss_b) < 0.05:
            return "cpu_bound_not_transport"
        if rtt_b < rtt_c * 0.8:
            return "network_bound"
    if loss_c > loss_b * 1.5:
        return "congestion_bound"
    return "cpu_bound_not_transport"


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: congestion_diff_engine.py <bbr.pcap> <cubic.pcap>\n")
        sys.exit(2)
    bbr_path = Path(sys.argv[1])
    cubic_path = Path(sys.argv[2])
    if not bbr_path.exists():
        sys.stderr.write(f"Missing: {bbr_path}\n")
        sys.exit(1)
    if not cubic_path.exists():
        sys.stderr.write(f"Missing: {cubic_path}\n")
        sys.exit(1)

    bbr = profile_pcap(bbr_path)
    cubic = profile_pcap(cubic_path)

    rtt_b = bbr.get("avg_rtt_ms") or 0
    rtt_c = cubic.get("avg_rtt_ms") or 0
    loss_b = bbr.get("loss_rate_percent") or 0
    loss_c = cubic.get("loss_rate_percent") or 0

    rtt_delta_percent = ((rtt_c - rtt_b) / rtt_b * 100) if rtt_b else 0
    loss_delta_percent = ((loss_c - loss_b) / loss_b * 100) if loss_b else (loss_c - loss_b)

    conclusion = classify_conclusion(bbr, cubic)

    out = {
        "bbr": {k: v for k, v in bbr.items() if k in ("avg_rtt_ms", "loss_rate_percent", "burst_loss_events", "udp_packets")},
        "cubic": {k: v for k, v in cubic.items() if k in ("avg_rtt_ms", "loss_rate_percent", "burst_loss_events", "udp_packets")},
        "delta": {
            "rtt_delta_percent": round(rtt_delta_percent, 2),
            "loss_delta_percent": round(loss_delta_percent, 2),
        },
        "conclusion": conclusion,
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
