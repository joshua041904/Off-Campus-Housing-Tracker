#!/usr/bin/env python3
"""
Transport Validation Harness v2 — Robust knee detection (noise-resistant).
Knee only when: sustained efficiency drop (< 0.6 × max_efficiency) for 3 consecutive steps
AND no recovery (>30% RPS) within next 2 steps.
If RPS recovers >30% within 2 steps → classify as runtime_instability, not knee.
"""
import json
import sys
from typing import Any

# Sustained drop threshold: eff must be below this fraction of max_efficiency for 3 steps
EFF_FRACTION = 0.6
# Recovery guard: if rps at i+2 is this much higher than at i, treat as instability not knee
RECOVERY_FACTOR = 1.3
# Need 3 consecutive low-efficiency steps plus 2 lookahead for recovery check
MIN_STEPS = 6


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
    curve = []
    for s in steps:
        vus = int(s.get("vus", 0) or 0)
        rps = get_float(s, "rps")
        eff = (rps / vus) if vus > 0 else 0.0
        curve.append({"vus": vus, "rps": round(rps, 2), "efficiency": round(eff, 4)})
    return curve


def detect_runtime_instability_steps(
    steps: list[dict[str, Any]],
    curve: list[dict[str, Any]],
    rps_drop_threshold: float = 0.5,
    recovery_ratio_threshold: float = 1.5,
    latency_spike_factor: float = 5.0,
) -> list[int]:
    """
    Steps where RPS dropped >50%, then recovered >50% within next 2 steps, and latency spiked >5× baseline.
    recovery_ratio = max(rps_{i+1}, rps_{i+2}) / rps_i; if > 1.5 then "recovered" → instability.
    """
    if len(steps) < 4:
        return []
    baseline_p95 = 0.0
    n_baseline = min(5, len(steps))
    for i in range(n_baseline):
        lat = steps[i].get("latency_ms") or steps[i]
        baseline_p95 += get_float(lat, "p95", "p95_ms")
    baseline_p95 = baseline_p95 / n_baseline if n_baseline else 1.0
    if baseline_p95 <= 0:
        baseline_p95 = 1.0

    instability_vus: list[int] = []
    for i in range(1, len(steps) - 1):
        rps_prev = get_float(steps[i - 1], "rps")
        rps_i = get_float(steps[i], "rps")
        if rps_prev <= 0 or rps_i <= 0:
            continue
        rps_drop = (rps_prev - rps_i) / rps_prev
        if rps_drop < rps_drop_threshold:
            continue
        rps_next1 = get_float(steps[i + 1], "rps") if i + 1 < len(steps) else 0
        rps_next2 = get_float(steps[i + 2], "rps") if i + 2 < len(steps) else 0
        max_future_rps = max(rps_next1, rps_next2)
        recovery_ratio = max_future_rps / rps_i
        if recovery_ratio < recovery_ratio_threshold:
            continue
        lat = steps[i].get("latency_ms") or steps[i]
        p95 = get_float(lat, "p95", "p95_ms")
        if baseline_p95 > 0 and p95 >= latency_spike_factor * baseline_p95:
            vus = int(steps[i].get("vus", 0) or 0)
            if vus and vus not in instability_vus:
                instability_vus.append(vus)
    return sorted(instability_vus)


def detect_knee_robust(
    steps: list[dict[str, Any]],
    curve: list[dict[str, Any]],
    instability_vus: list[int],
) -> tuple[dict[str, Any] | None, bool]:
    """
    Knee = first step i where:
    - eff_i, eff_{i+1}, eff_{i+2} all < 0.6 * max_efficiency_seen
    - RPS does not recover to > 1.3 * rps_i within next 2 steps
    - Step i is not in instability_vus (recovery guard).
    """
    if len(steps) < MIN_STEPS or len(curve) < MIN_STEPS:
        return None, False

    max_eff = max(c["efficiency"] for c in curve)
    if max_eff <= 0:
        return None, False

    threshold_eff = EFF_FRACTION * max_eff
    knee_info = None
    plateau_detected = False

    for i in range(len(steps) - 2):
        vus_i = int(steps[i].get("vus", 0) or 0)
        if vus_i in instability_vus:
            continue
        eff_i = curve[i]["efficiency"]
        eff_i1 = curve[i + 1]["efficiency"] if i + 1 < len(curve) else 0
        eff_i2 = curve[i + 2]["efficiency"] if i + 2 < len(curve) else 0
        if eff_i >= threshold_eff or eff_i1 >= threshold_eff or eff_i2 >= threshold_eff:
            continue
        rps_i = get_float(steps[i], "rps")
        rps_i2 = get_float(steps[i + 2], "rps") if i + 2 < len(steps) else 0
        if rps_i > 0 and rps_i2 >= RECOVERY_FACTOR * rps_i:
            continue
        lat = steps[i].get("latency_ms") or steps[i]
        knee_info = {
            "knee_vus": vus_i,
            "knee_rps": curve[i]["rps"],
            "p95_at_knee_ms": round(get_float(lat, "p95", "p95_ms"), 2),
            "avg_at_knee_ms": round(get_float(lat, "avg", "avg_ms"), 2),
            "index": i,
            "efficiency_at_knee": curve[i]["efficiency"],
            "max_efficiency_seen": round(max_eff, 4),
            "robust_v2": True,
        }
        plateau_detected = True
        break

    if not plateau_detected and max_eff > 0:
        for c in curve:
            if c["efficiency"] < threshold_eff:
                plateau_detected = True
                break

    return knee_info, plateau_detected


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: knee_detection_v3.py <ramp_steps.json>\n")
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    steps = data if isinstance(data, list) else data.get("steps", data.get("ramp_steps", []))
    if not steps:
        sys.stderr.write("No steps in input\n")
        sys.exit(1)

    curve = efficiency_curve(steps)
    instability_vus = detect_runtime_instability_steps(steps, curve)
    knee, plateau_detected = detect_knee_robust(steps, curve, instability_vus)
    max_rps = max((get_float(s, "rps") for s in steps), default=0)
    last = steps[-1] if steps else {}

    result = {
        "knee": knee,
        "efficiency_curve": curve,
        "plateau_detected": plateau_detected,
        "runtime_instability_detected": len(instability_vus) > 0,
        "instability_steps": instability_vus,
        "max_rps": round(max_rps, 2),
        "last_vus": int(last.get("vus", 0)),
        "last_rps": round(get_float(last, "rps"), 2),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
