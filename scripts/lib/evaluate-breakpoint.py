#!/usr/bin/env python3
"""
Transport Benchmarking V5: Evaluate if H3 run is past breakpoint.
Exit 0 = run is healthy (within thresholds).
Exit 1 = run broke (error_rate > 1% or timeout_rate > 1% or p95 > 5× baseline avg).
"""
import json
import sys


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: evaluate-breakpoint.py <transport-summary.json>\n")
        sys.exit(2)

    path = sys.argv[1]
    try:
        with open(path) as f:
            data = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"File not found: {path}\n")
        sys.exit(2)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON: {e}\n")
        sys.exit(2)

    error_rate = data.get("error_rate") or 0
    timeout_rate = data.get("timeout_rate") or 0
    latency = data.get("latency_ms") or {}
    avg_ms = latency.get("avg") or 0
    p95_ms = latency.get("p95") or 0

    if error_rate > 0.01:
        sys.stderr.write(f"Break: error_rate {error_rate} > 1%\n")
        sys.exit(1)
    if timeout_rate > 0.01:
        sys.stderr.write(f"Break: timeout_rate {timeout_rate} > 1%\n")
        sys.exit(1)
    # p95 > 5× baseline (use avg as baseline when no separate baseline)
    if avg_ms > 0 and p95_ms > 5 * avg_ms:
        sys.stderr.write(f"Break: p95 {p95_ms}ms > 5× avg {avg_ms}ms\n")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
