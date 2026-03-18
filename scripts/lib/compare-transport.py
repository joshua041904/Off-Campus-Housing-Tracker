#!/usr/bin/env python3
"""
Transport Benchmarking V5: Compare H2 vs H3 runs.
Reads h2-summary.json and h3-summary.json (or paths from argv) and outputs
objective comparison: rps_delta_pct, p95_delta_ms, error_rate_delta.
"""
import json
import sys


def main():
    if len(sys.argv) >= 3:
        h2_path = sys.argv[1]
        h3_path = sys.argv[2]
    else:
        h2_path = "h2-summary.json"
        h3_path = "h3-summary.json"

    try:
        with open(h2_path) as f:
            h2 = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"Missing {h2_path}. Run H2-only k6 and save output as h2-summary.json\n")
        sys.exit(1)
    try:
        with open(h3_path) as f:
            h3 = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"Missing {h3_path}. Run H3-only k6 and save output as h3-summary.json\n")
        sys.exit(1)

    h2_rps = h2.get("rps") or 0
    h3_rps = h3.get("rps") or 0
    if h2_rps == 0:
        rps_delta_pct = 0.0
    else:
        rps_delta_pct = (h3_rps - h2_rps) / h2_rps * 100

    h2_p95 = (h2.get("latency_ms") or {}).get("p95") or 0
    h3_p95 = (h3.get("latency_ms") or {}).get("p95") or 0
    p95_delta_ms = h3_p95 - h2_p95

    error_rate_delta = (h3.get("error_rate") or 0) - (h2.get("error_rate") or 0)

    comparison = {
        "rps_delta_pct": round(rps_delta_pct, 2),
        "p95_delta_ms": round(p95_delta_ms, 2),
        "error_rate_delta": round(error_rate_delta, 6),
    }
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
