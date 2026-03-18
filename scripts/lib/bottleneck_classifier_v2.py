#!/usr/bin/env python3
"""
Transport Validation Engine — Bound classifier v2.
Classifies saturation as: cpu | transport | network | buffer | scheduler
using BBR vs CUBIC delta, UDP loss, latency shape, and optional pcap loss/reorder signals.
"""
import json
import sys
from typing import Any


def get_float(d: dict, *keys: str, default: float = 0.0) -> float:
    for k in keys:
        v = d.get(k)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return default


def classify_bottleneck_v2(
    ramp_steps: list[dict],
    udp_errors: int = 0,
    quic_retry_ratio: float = 0.0,
    handshake_complete_ratio: float | None = 1.0,
    rtt_variance_spike: bool = False,
    bbr_vs_cubic_delta_percent: float | None = None,
    loss_rate_percent: float | None = None,
    burst_loss_detected: bool = False,
    reordering_detected: bool = False,
    scheduler_contention_detected: bool = False,
    tail_ratio_high: bool = False,
) -> tuple[str, str, float]:
    """
    Returns (bottleneck_class, transport_state, confidence).
    bottleneck_class: "cpu" | "transport" | "network" | "buffer" | "scheduler" | "no_quic_listener"
    transport_state: "saturated" | "no_quic_listener"
    confidence: 0.0–1.0
    """
    # Cluster-dead pattern
    if ramp_steps:
        rps_list = [get_float(s, "rps") for s in ramp_steps]
        max_rps = max(rps_list) if rps_list else 0
        p95_list = []
        for s in ramp_steps:
            lat = s.get("latency_ms") or {}
            p95_list.append(get_float(lat, "p95", "p95_ms"))
        max_p95 = max(p95_list) if p95_list else 0
        if max_rps < 1 and max_p95 >= 8000:
            return ("no_quic_listener", "no_quic_listener", 0.95)

    # Strong transport signals
    if udp_errors > 0 or quic_retry_ratio > 0.01:
        return ("transport", "saturated", 0.9)
    if burst_loss_detected or (loss_rate_percent is not None and loss_rate_percent > 0.1):
        return ("transport", "saturated", 0.85)
    if reordering_detected and (loss_rate_percent or 0) > 0.05:
        return ("transport", "saturated", 0.8)

    # Scheduler contention: variance/tail without packet loss
    if scheduler_contention_detected and not burst_loss_detected and (loss_rate_percent or 0) < 0.05:
        return ("scheduler", "saturated", 0.75)
    if tail_ratio_high and not burst_loss_detected and (loss_rate_percent or 0) < 0.05:
        return ("buffer", "saturated", 0.7)

    # Crypto (handshake)
    if handshake_complete_ratio is not None and handshake_complete_ratio < 0.99:
        return ("crypto", "saturated", 0.85)
    if rtt_variance_spike and not burst_loss_detected:
        return ("network", "saturated", 0.7)

    # BBR vs CUBIC interpretation
    if bbr_vs_cubic_delta_percent is not None:
        delta = float(bbr_vs_cubic_delta_percent)
        # BBR >> CUBIC (delta large positive) → network/congestion bound
        if delta > 15:
            return ("network", "saturated", 0.8)
        # BBR ≈ CUBIC (delta small) → CPU bound
        if -10 <= delta <= 10:
            return ("cpu", "saturated", 0.92)

    # Heuristic: RPS plateau + smooth p95 growth → cpu
    if not ramp_steps or len(ramp_steps) < 3:
        return ("cpu", "saturated", 0.5)

    rps_list = [get_float(s, "rps") for s in ramp_steps]
    p95_list = [get_float(s.get("latency_ms") or {}, "p95", "p95_ms") for s in ramp_steps]
    max_rps = max(rps_list)
    # Early latency spike (crypto-bound)
    third = max(1, len(p95_list) // 3)
    early_avg = sum(p95_list[:third]) / third
    late_avg = sum(p95_list[-third:]) / third if third else early_avg
    if early_avg > 50 and late_avg < early_avg * 2 and max_rps < 5000:
        return ("crypto", "saturated", 0.8)

    return ("cpu", "saturated", 0.85)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write(
            "Usage: bottleneck_classifier_v2.py <ramp_steps.json> [validation.json] [comparison_input.json] [quic_loss.json]\n"
        )
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    steps = data if isinstance(data, list) else data.get("steps", data.get("ramp_steps", []))

    udp_errors = 0
    quic_retry_ratio = 0.0
    handshake_complete_ratio = 1.0
    loss_rate_percent = None
    burst_loss_detected = False
    reordering_detected = False

    if len(sys.argv) >= 3:
        try:
            with open(sys.argv[2]) as vf:
                v = json.load(vf)
            udp_errors = int(v.get("udp_errors") or 0)
            quic_retry_ratio = float(v.get("quic_retry_ratio") or 0)
            handshake_complete_ratio = v.get("handshake_complete_ratio")
        except Exception:
            pass

    bbr_vs_cubic_delta_percent = None
    if len(sys.argv) >= 4:
        try:
            with open(sys.argv[3]) as cf:
                c = json.load(cf)
            bbr_vs_cubic_delta_percent = c.get("bbr_vs_cubic_delta_percent")
        except Exception:
            pass

    if len(sys.argv) >= 5:
        try:
            with open(sys.argv[4]) as qf:
                q = json.load(qf)
            loss_rate_percent = q.get("loss_rate_percent")
            burst_loss_detected = bool(q.get("burst_loss_detected", False))
            reordering_detected = bool(q.get("reordering_detected", False))
        except Exception:
            pass

    result, transport_state, confidence = classify_bottleneck_v2(
        steps,
        udp_errors=udp_errors,
        quic_retry_ratio=quic_retry_ratio,
        handshake_complete_ratio=handshake_complete_ratio,
        bbr_vs_cubic_delta_percent=bbr_vs_cubic_delta_percent,
        loss_rate_percent=loss_rate_percent,
        burst_loss_detected=burst_loss_detected,
        reordering_detected=reordering_detected,
    )
    out = {
        "bottleneck_class": result,
        "transport_state": transport_state,
        "bound_confidence": round(confidence, 2),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
