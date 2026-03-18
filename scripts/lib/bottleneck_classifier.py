#!/usr/bin/env python3
"""
Transport Validation Engine — Layer 7: Bottleneck classification.
Classifies saturation as: cpu | crypto | transport from RTT variance, UDP errors, handshake retry ratio, latency shape.
"""
import json
import sys
from typing import Any


def classify_bottleneck(
    ramp_steps: list[dict],
    udp_errors: int = 0,
    quic_retry_ratio: float = 0.0,
    handshake_complete_ratio: float | None = 1.0,
    rtt_variance_spike: bool = False,
) -> tuple[str, str]:
    """
    Returns (bottleneck_class, transport_state).
    bottleneck_class: "cpu" | "crypto" | "transport" | "no_quic_listener"
    transport_state: "saturated" | "no_quic_listener" (no_quic_listener = dead infra, not saturation).

    - no_quic_listener: throughput 0, latency wall ~10s, no real QUIC — cluster/ingress dead.
    - cpu: RPS plateau, latency rises gradually, UDP errors 0.
    - crypto: handshake retries up, latency spike early.
    - transport: UDP errors > 0, retry packets up, RTT variance spikes.
    """
    # Cluster-dead pattern: throughput = 0, all requests hit timeout wall (~10s), no QUIC listener
    if ramp_steps:
        rps_list = [float(s.get("rps", 0) or 0) for s in ramp_steps]
        max_rps = max(rps_list) if rps_list else 0
        p95_list = []
        for s in ramp_steps:
            lat = s.get("latency_ms") or {}
            p95_list.append(float(lat.get("p95", 0) or lat.get("p95_ms", 0) or 0))
        max_p95 = max(p95_list) if p95_list else 0
        # Throughput zero and latency wall near 10s (k6 default timeout) → no server answering QUIC
        if max_rps < 1 and max_p95 >= 8000:
            return ("no_quic_listener", "no_quic_listener")

    if udp_errors > 0 or quic_retry_ratio > 0.01:
        return ("transport", "saturated")
    if handshake_complete_ratio is not None and handshake_complete_ratio < 0.99:
        return ("crypto", "saturated")
    if rtt_variance_spike:
        return ("transport", "saturated")

    if not ramp_steps:
        return ("cpu", "saturated")

    # Heuristic: if p95 grows smoothly with VUs and RPS plateaus → cpu
    # If p95 spikes early relative to RPS → crypto
    rps_list = [float(s.get("rps", 0) or 0) for s in ramp_steps]
    p95_list = []
    for s in ramp_steps:
        lat = s.get("latency_ms") or {}
        p95_list.append(float(lat.get("p95", 0) or lat.get("p95_ms", 0) or 0))

    if len(p95_list) < 3:
        return ("cpu", "saturated")

    # Early latency spike (first third of steps): crypto-bound signature
    third = max(1, len(p95_list) // 3)
    early_avg = sum(p95_list[:third]) / third if third else 0
    late_avg = sum(p95_list[-third:]) / third if third else 0
    if early_avg > 50 and late_avg < early_avg * 2 and max(rps_list) < 5000:
        return ("crypto", "saturated")

    return ("cpu", "saturated")


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: bottleneck_classifier.py <ramp_steps.json> [validation_result.json]\n")
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    steps = data if isinstance(data, list) else data.get("steps", data.get("ramp_steps", []))
    udp_errors = 0
    quic_retry_ratio = 0.0
    handshake_complete_ratio = 1.0
    if len(sys.argv) >= 3:
        try:
            with open(sys.argv[2]) as vf:
                v = json.load(vf)
            udp_errors = int(v.get("udp_errors") or 0)
            quic_retry_ratio = float(v.get("quic_retry_ratio") or 0)
            handshake_complete_ratio = v.get("handshake_complete_ratio")
        except Exception:
            pass
    result, transport_state = classify_bottleneck(
        steps,
        udp_errors=udp_errors,
        quic_retry_ratio=quic_retry_ratio,
        handshake_complete_ratio=handshake_complete_ratio,
    )
    out = {"bottleneck_class": result, "transport_state": transport_state}
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
