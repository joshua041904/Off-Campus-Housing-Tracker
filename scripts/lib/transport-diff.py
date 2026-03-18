#!/usr/bin/env python3
"""
Baseline vs rotation transport summary diff.
Loads baseline/transport-summary.json and rotation/transport-summary.json,
computes diff (UDP/TCP change %, TLS handshake delta, QUIC version change),
outputs JSON and human-readable summary.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def pct_change(old: float, new: float) -> float:
    if old == 0:
        return 0.0 if new == 0 else 100.0
    return round(((new - old) / old) * 100, 2)


def main() -> int:
    base_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("captures")
    baseline_path = base_dir / "baseline" / "transport-summary.json"
    rotation_path = base_dir / "rotation" / "transport-summary.json"
    if len(sys.argv) >= 3:
        baseline_path = Path(sys.argv[1])
        rotation_path = Path(sys.argv[2])
        base_dir = baseline_path.parent.parent

    if not baseline_path.exists():
        print("Baseline summary not found:", baseline_path, file=sys.stderr)
        return 1
    if not rotation_path.exists():
        print("Rotation summary not found:", rotation_path, file=sys.stderr)
        return 1

    with open(baseline_path) as f:
        baseline = json.load(f)
    with open(rotation_path) as f:
        rotation = json.load(f)

    tcp_b = baseline.get("tcp_443", 0) or 0
    udp_b = baseline.get("udp_443", 0) or 0
    tcp_r = rotation.get("tcp_443", 0) or 0
    udp_r = rotation.get("udp_443", 0) or 0

    tls_b = baseline.get("tls_handshake_ms") or {}
    tls_r = rotation.get("tls_handshake_ms") or {}
    avg_b = tls_b.get("avg", 0) or 0
    avg_r = tls_r.get("avg", 0) or 0
    tls_delta_ms = round(avg_r - avg_b, 2)

    quic_versions_b = baseline.get("quic_versions") or {}
    quic_versions_r = rotation.get("quic_versions") or {}
    quic_version_changed = quic_versions_b != quic_versions_r

    diff = {
        "summary": {
            "udp_change_pct": pct_change(udp_b, udp_r),
            "tcp_change_pct": pct_change(tcp_b, tcp_r),
            "tls_handshake_delta_ms": tls_delta_ms,
            "quic_version_changed": quic_version_changed,
        }
    }

    print(json.dumps(diff, indent=2))

    print()
    print("--- Transport diff (baseline vs rotation) ---")
    print("QUIC version:", "changed" if quic_version_changed else "unchanged")
    print("UDP 443 volume:", f"{diff['summary']['udp_change_pct']:+.1f}%")
    print("TCP 443 volume:", f"{diff['summary']['tcp_change_pct']:+.1f}%")
    print("TLS handshake latency (avg):", f"{tls_delta_ms:+.1f}ms")
    print("---------------------------------------------")

    out_path = base_dir / "transport-diff.json"
    if len(sys.argv) <= 3:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(diff, f, indent=2)
        print("Wrote", out_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
