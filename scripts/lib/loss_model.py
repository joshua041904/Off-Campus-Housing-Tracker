#!/usr/bin/env python3
"""
Simple loss severity view derived from analyze_quic_metrics / quic_loss_analyzer JSON.
Reads metrics path, writes JSON to stdout.
"""
import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: loss_model.py <quic-metrics.json>\n")
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as f:
        m = json.load(f)
    loss = float(m.get("loss_rate_percent") or 0)
    if loss < 0.5:
        severity = "low"
    elif loss < 2.0:
        severity = "medium"
    else:
        severity = "high"
    doc = {
        "loss_rate_percent": loss,
        "severity": severity,
        "reordering_detected": bool(m.get("reordering_detected")),
        "burst_loss_detected": bool(m.get("burst_loss_detected")),
        "source": "loss_model",
    }
    print(json.dumps(doc, indent=2))


if __name__ == "__main__":
    main()
