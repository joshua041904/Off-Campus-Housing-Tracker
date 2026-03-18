#!/usr/bin/env python3
"""
Transport Validation Engine — Plateau-aware knee detection v2.
Knee = first step where efficiency (RPS/VU) drops >15% from baseline AND p95 growth > 2× baseline.
Also computes efficiency curve and plateau_detected for ceiling report v2.
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


def efficiency_curve(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-step efficiency = rps / vus; derivative optional."""
    curve = []
    for s in steps:
        vus = int(s.get("vus", 0) or 0)
        rps = get_float(s, "rps")
        if vus <= 0:
            eff = 0.0
        else:
            eff = rps / vus
        curve.append({"vus": vus, "rps": round(rps, 2), "efficiency": round(eff, 4)})
    return curve


def baseline_efficiency_and_p95(
    steps: list[dict[str, Any]],
    curve: list[dict[str, Any]],
    low_idx: int = 2,
    high_idx: int = 9,
) -> tuple[float, float]:
    """
    Baseline = average efficiency and p95 over steps [low_idx, high_idx).
    Uses first N steps where system is typically linear.
    """
    if not steps or not curve or high_idx <= low_idx:
        return 0.0, 0.0
    eff_sum = 0.0
    p95_sum = 0.0
    n = 0
    for i in range(low_idx, min(high_idx, len(steps))):
        if i < len(curve):
            eff_sum += curve[i]["efficiency"]
        lat = steps[i].get("latency_ms") or steps[i]
        p95_sum += get_float(lat, "p95", "p95_ms")
        n += 1
    if n == 0:
        return 0.0, 0.0
    return eff_sum / n, p95_sum / n


def detect_knee_plateau(
    steps: list[dict[str, Any]],
    efficiency_drop_threshold: float = 0.15,
    p95_growth_threshold: float = 2.0,
    baseline_low: int = 2,
    baseline_high: int = 9,
) -> tuple[dict[str, Any] | None, bool]:
    """
    Returns (knee_info or None, plateau_detected).
    Knee = first step where efficiency < baseline * (1 - efficiency_drop_threshold)
    AND p95 > baseline_p95 * p95_growth_threshold.
    Plateau = we found a knee (saturation) or max efficiency drop in curve > 15%.
    """
    if len(steps) < baseline_high:
        return None, False

    curve = efficiency_curve(steps)
    baseline_eff, baseline_p95 = baseline_efficiency_and_p95(
        steps, curve, baseline_low, baseline_high
    )
    if baseline_eff <= 0:
        return None, False

    plateau_detected = False
    knee_info = None

    for i in range(baseline_high, len(steps)):
        eff = curve[i]["efficiency"]
        lat = steps[i].get("latency_ms") or steps[i]
        p95 = get_float(lat, "p95", "p95_ms")

        efficiency_drop = (baseline_eff - eff) / baseline_eff if baseline_eff else 0
        if efficiency_drop > efficiency_drop_threshold:
            plateau_detected = True
        p95_growth = p95 / baseline_p95 if baseline_p95 > 0 else 0

        if efficiency_drop >= efficiency_drop_threshold and p95_growth >= p95_growth_threshold:
            knee_info = {
                "knee_vus": curve[i]["vus"],
                "knee_rps": curve[i]["rps"],
                "p95_at_knee_ms": round(p95, 2),
                "avg_at_knee_ms": round(get_float(lat, "avg", "avg_ms"), 2),
                "index": i,
                "efficiency_at_knee": curve[i]["efficiency"],
                "baseline_efficiency": round(baseline_eff, 4),
                "plateau_style": True,
            }
            plateau_detected = True
            break

    # If no strict knee but efficiency clearly dropped in later steps, still mark plateau
    if not plateau_detected and len(curve) > baseline_high:
        for i in range(baseline_high, len(curve)):
            if curve[i]["efficiency"] < baseline_eff * (1 - efficiency_drop_threshold):
                plateau_detected = True
                break

    return knee_info, plateau_detected


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: knee_detection_v2.py <ramp_steps.json>\n")
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    steps = data if isinstance(data, list) else data.get("steps", data.get("ramp_steps", []))
    if not steps:
        sys.stderr.write("No steps in input\n")
        sys.exit(1)

    curve = efficiency_curve(steps)
    knee, plateau_detected = detect_knee_plateau(steps)
    max_rps = max((get_float(s, "rps") for s in steps), default=0)
    last = steps[-1] if steps else {}

    result = {
        "knee": knee,
        "efficiency_curve": curve,
        "plateau_detected": plateau_detected,
        "max_rps": round(max_rps, 2),
        "last_vus": int(last.get("vus", 0)),
        "last_rps": round(get_float(last, "rps"), 2),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
