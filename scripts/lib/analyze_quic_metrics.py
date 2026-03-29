#!/usr/bin/env python3
"""
Emit QUIC loss / gap metrics JSON from a pcap (stdout).
Delegates to quic_loss_analyzer.analyze; always exits 0 with valid JSON.
"""
import json
import sys
from pathlib import Path

# Same directory as this script
_LIB = Path(__file__).resolve().parent
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

from quic_loss_analyzer import analyze  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: analyze_quic_metrics.py <pcap>\n")
        sys.exit(2)
    out = analyze(sys.argv[1])
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
