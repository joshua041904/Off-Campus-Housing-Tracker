"""CLI: dpkt-based QUIC passive forensics → JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analyze import analyze_pcap_dpkt


def main() -> int:
    ap = argparse.ArgumentParser(description="Passive QUIC PCAP analysis (dpkt, no tshark).")
    ap.add_argument("pcap", help="Path to .pcap file")
    ap.add_argument("--output", "-o", help="Write JSON report here")
    args = ap.parse_args()
    try:
        report = analyze_pcap_dpkt(args.pcap)
    except Exception as e:  # pragma: no cover
        report = {"valid": False, "error": str(e), "parser": "dpkt-passive"}
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)
    return 0 if report.get("valid") else 1


if __name__ == "__main__":
    sys.exit(main())
