#!/usr/bin/env python3
"""
Best-effort pcap summary: TCP retransmissions, RST/FIN, TLS alerts (tshark).
Output JSON to stdout. Requires tshark.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def tshark_count(pcap: Path, display_filter: str) -> int:
    try:
        r = subprocess.run(
            [
                "tshark",
                "-r",
                str(pcap),
                "-Y",
                display_filter,
                "-T",
                "fields",
                "-e",
                "frame.number",
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if r.returncode != 0:
            return -1
        lines = [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
        return len(lines)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return -1


def tls_alerts_sample(pcap: Path, limit: int = 50) -> list[dict]:
    out: list[dict] = []
    try:
        r = subprocess.run(
            [
                "tshark",
                "-r",
                str(pcap),
                "-Y",
                "tls.alert_message",
                "-T",
                "fields",
                "-e",
                "frame.time_epoch",
                "-e",
                "tls.alert_message",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if r.returncode != 0:
            return out
        for line in (r.stdout or "").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                out.append({"epoch": parts[0], "alert": parts[1]})
            if len(out) >= limit:
                break
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return out


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: pcap_transport_summary.py <pcap>"}))
        sys.exit(2)
    pcap = Path(sys.argv[1])
    if not pcap.is_file():
        print(json.dumps({"error": "no file"}))
        sys.exit(1)

    syn_flood_heuristic = tshark_count(pcap, "tcp.flags.syn==1 && tcp.flags.ack==0")
    tcp_rst = tshark_count(pcap, "tcp.flags.reset==1")
    tcp_retrans = tshark_count(pcap, "tcp.analysis.retransmission")
    quic_rows = tshark_count(pcap, "quic")

    result = {
        "pcap": str(pcap),
        "tcp_syn_no_ack_count": syn_flood_heuristic,
        "tcp_rst_count": tcp_rst,
        "tcp_retransmission_count": tcp_retrans,
        "quic_packet_rows": quic_rows,
        "tls_alerts_sample": tls_alerts_sample(pcap),
        "notes": "syn_no_ack is heuristic only; use specialist tools for true SYN flood analysis.",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
