#!/usr/bin/env python3
"""
QUIC packet-number gap loss analyzer.
Extracts packet numbers from pcap via tshark, detects gaps (missing sequence),
burst loss (consecutive gaps in same time window), and reordering.
Output: JSON loss profile for transport_ceiling_report and bottleneck classifier.
"""
import json
import subprocess
import sys
from pathlib import Path

BURST_WINDOW_SEC = 0.01  # 10ms: gaps within same window count as burst


def run_tshark_fields(pcap: Path, display_filter: str, fields: list[str]) -> list[list[str]]:
    try:
        cmd = ["tshark", "-r", str(pcap), "-Y", display_filter, "-T", "fields", "-e"] + fields
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            return []
        out = []
        for line in (r.stdout or "").splitlines():
            parts = [p.strip() for p in line.split("\t")]
            if any(parts):
                out.append(parts)
        return out
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []


def parse_packet_numbers(pcap: Path) -> list[tuple[float, int]]:
    """Return list of (time_epoch, packet_number) for QUIC packets with packet_number."""
    # tshark -r pcap -Y quic -T fields -e frame.time_epoch -e quic.packet_number
    rows = run_tshark_fields(
        pcap, "quic", ["frame.time_epoch", "quic.packet_number"]
    )
    result = []
    for row in rows:
        if len(row) < 2:
            continue
        try:
            t = float(row[0])
            pn = int(row[1])
            result.append((t, pn))
        except (ValueError, TypeError):
            continue
    return result


def detect_gaps(packet_numbers: list[int]) -> list[tuple[int, int]]:
    """Sorted packet numbers -> list of (expected_next, actual_next) gaps (lost count = actual - expected - 1)."""
    if len(packet_numbers) < 2:
        return []
    sorted_pn = sorted(set(packet_numbers))
    gaps = []
    for i in range(1, len(sorted_pn)):
        expected = sorted_pn[i - 1] + 1
        actual = sorted_pn[i]
        if actual > expected:
            gaps.append((expected, actual))
    return gaps


def lost_packets_from_gaps(gaps: list[tuple[int, int]]) -> int:
    return sum(actual - expected for expected, actual in gaps)


def detect_reordering(time_and_pn: list[tuple[float, int]]) -> bool:
    """True if in arrival order any packet has a lower packet number than a previous one."""
    if len(time_and_pn) < 2:
        return False
    max_seen = -1
    for _t, pn in time_and_pn:
        if pn < max_seen:
            return True
        max_seen = max(max_seen, pn)
    return False


def detect_burst_loss(
    time_and_pn: list[tuple[float, int]], gaps: list[tuple[int, int]]
) -> bool:
    """Burst = two or more gaps whose packet numbers fall within BURST_WINDOW_SEC of each other."""
    if len(gaps) < 2:
        return False
    # Build set of "lost" packet numbers (expected..actual-1 for each gap)
    lost_ranges = [(exp, act - 1) for exp, act in gaps]
    time_by_pn = {pn: t for t, pn in time_and_pn}
    for i, (exp1, act1) in enumerate(lost_ranges):
        for exp2, act2 in lost_ranges[i + 1 :]:
            # Any lost packet from first gap and any from second gap within window?
            t1 = time_by_pn.get(exp1) or time_by_pn.get(act1)
            t2 = time_by_pn.get(exp2) or time_by_pn.get(act2)
            if t1 is not None and t2 is not None and abs(t1 - t2) <= BURST_WINDOW_SEC:
                return True
    return False


def analyze(pcap_path: str | Path) -> dict:
    pcap = Path(pcap_path)
    if not pcap.exists() or pcap.stat().st_size < 256:
        return {
            "error": "pcap missing or too small",
            "total_packets": 0,
            "gap_events": 0,
            "lost_packets_estimated": 0,
            "loss_rate_percent": 0.0,
            "reordering_detected": False,
            "burst_loss_detected": False,
        }

    time_and_pn = parse_packet_numbers(pcap)
    packet_numbers = [pn for _, pn in time_and_pn]
    total = len(packet_numbers)
    if total == 0:
        return {
            "error": "no QUIC packet numbers in pcap",
            "total_packets": 0,
            "gap_events": 0,
            "lost_packets_estimated": 0,
            "loss_rate_percent": 0.0,
            "reordering_detected": False,
            "burst_loss_detected": False,
        }

    gaps = detect_gaps(packet_numbers)
    lost = lost_packets_from_gaps(gaps)
    loss_rate = (lost / total * 100) if total else 0.0
    reordering = detect_reordering(time_and_pn)
    burst = detect_burst_loss(time_and_pn, gaps)

    return {
        "total_packets": total,
        "gap_events": len(gaps),
        "lost_packets_estimated": lost,
        "loss_rate_percent": round(loss_rate, 4),
        "reordering_detected": reordering,
        "burst_loss_detected": burst,
    }


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: quic_loss_analyzer.py <pcap>\n")
        sys.exit(2)
    result = analyze(sys.argv[1])
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("error") is None else 1)


if __name__ == "__main__":
    main()
