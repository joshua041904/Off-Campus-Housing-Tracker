#!/usr/bin/env python3
"""Summarize HTTP/3 frames seen in a pcap via tshark (best-effort)."""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: http3_frame_inspector.py <pcap>"}))
        sys.exit(2)
    pcap = Path(sys.argv[1])
    if not pcap.is_file() or pcap.stat().st_size < 64:
        print(json.dumps({"error": "missing or tiny pcap", "path": str(pcap)}))
        sys.exit(1)
    try:
        r = subprocess.run(
            [
                "tshark",
                "-r",
                str(pcap),
                "-Y",
                "http3",
                "-T",
                "fields",
                "-e",
                "http3.frame_type",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(json.dumps({"error": str(e), "http3_frame_type_counts": {}}))
        sys.exit(1)
    types: list[str] = []
    for line in (r.stdout or "").splitlines():
        t = line.strip()
        if t:
            types.append(t)
    c = Counter(types)
    out = {
        "pcap": str(pcap),
        "http3_rows": len(types),
        "frame_type_counts": dict(c.most_common(50)),
        "tshark_rc": r.returncode,
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
