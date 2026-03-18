#!/usr/bin/env python3
"""
Transport Validation Engine — Layer 3: Robust knee detection.
Knee = first step where 2 consecutive throughput gains < 3% AND p95 latency acceleration > 20%.
Also detects concurrency plateau (effective_concurrency delta < 5% for 2 steps).
"""
import json
import sys
from typing import Any


def smooth_curve(values: list[float], window: int = 2) -> list[float]:
    """Moving average; first points unchanged if window > 1."""
    if not values or window <= 1:
        return list(values)
    out = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        out.append(sum(values[start : i + 1]) / (i - start + 1))
    return out


def detect_knee(
    steps: list[dict[str, Any]],
    gain_threshold: float = 0.03,
    lat_accel_threshold: float = 0.20,
    skip_first_n: int = 2,
    require_two_consecutive: bool = True,
) -> dict[str, Any] | None:
    """
    steps: list of { "vus", "rps", "p95_ms", "avg_ms" } (or latency_ms.p95 / .avg).
    Returns knee step info or None.
    """
    if len(steps) <= skip_first_n + 1:
        return None

    rps_list = []
    p95_list = []
    avg_list = []
    vus_list = []
    for s in steps:
        vus_list.append(int(s.get("vus", 0)))
        rps_list.append(float(s.get("rps", 0) or 0))
        lat = s.get("latency_ms") or {}
        p95_list.append(float(lat.get("p95", 0) or lat.get("p95_ms", 0) or 0))
        avg_list.append(float(lat.get("avg", 0) or lat.get("avg_ms", 0) or 0))

    rps_smooth = smooth_curve(rps_list)
    p95_smooth = smooth_curve(p95_list)

    for i in range(skip_first_n + 1, len(steps)):
        if rps_smooth[i - 1] <= 0:
            continue
        gain_i = (rps_smooth[i] - rps_smooth[i - 1]) / rps_smooth[i - 1]
        if p95_smooth[i - 1] <= 0:
            lat_accel_i = 0.0
        else:
            lat_accel_i = (p95_smooth[i] - p95_smooth[i - 1]) / p95_smooth[i - 1]

        if require_two_consecutive and i >= skip_first_n + 2:
            gain_prev = (rps_smooth[i - 1] - rps_smooth[i - 2]) / rps_smooth[i - 2] if rps_smooth[i - 2] > 0 else 1.0
            if gain_i < gain_threshold and gain_prev < gain_threshold and lat_accel_i > lat_accel_threshold:
                return {
                    "knee_vus": vus_list[i],
                    "knee_rps": round(rps_smooth[i], 2),
                    "p95_at_knee_ms": round(p95_smooth[i], 2),
                    "avg_at_knee_ms": round(avg_list[i], 2) if i < len(avg_list) else 0,
                    "index": i,
                }
        elif not require_two_consecutive and gain_i < gain_threshold and lat_accel_i > lat_accel_threshold:
            return {
                "knee_vus": vus_list[i],
                "knee_rps": round(rps_smooth[i], 2),
                "p95_at_knee_ms": round(p95_smooth[i], 2),
                "avg_at_knee_ms": round(avg_list[i], 2) if i < len(avg_list) else 0,
                "index": i,
            }
    return None


def detect_concurrency_plateau(
    steps: list[dict[str, Any]],
    delta_threshold: float = 0.05,
    consecutive: int = 2,
) -> int | None:
    """First index where effective concurrency (rps * avg_latency_sec) delta < threshold for `consecutive` steps."""
    if len(steps) < consecutive + 1:
        return None

    concurrency = []
    for s in steps:
        rps = float(s.get("rps", 0) or 0)
        lat = s.get("latency_ms") or {}
        avg_ms = float(lat.get("avg", 0) or lat.get("avg_ms", 0) or 0)
        concurrency.append(rps * (avg_ms / 1000.0) if avg_ms else 0)

    for i in range(consecutive, len(concurrency)):
        ok = True
        for j in range(consecutive):
            idx = i - j
            if idx <= 0 or concurrency[idx - 1] <= 0:
                ok = False
                break
            delta = abs(concurrency[idx] - concurrency[idx - 1]) / concurrency[idx - 1]
            if delta >= delta_threshold:
                ok = False
                break
        if ok:
            return i
    return None


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: knee_detection.py <ramp_steps.json>\n")
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    steps = data if isinstance(data, list) else data.get("steps", data.get("ramp_steps", []))
    if not steps:
        sys.stderr.write("No steps in input\n")
        sys.exit(1)

    knee = detect_knee(steps)
    plateau_idx = detect_concurrency_plateau(steps)
    max_rps = max((float(s.get("rps", 0) or 0) for s in steps), default=0)
    last = steps[-1] if steps else {}
    result = {
        "knee": knee,
        "concurrency_plateau_at_index": plateau_idx,
        "max_rps": round(max_rps, 2),
        "last_vus": int(last.get("vus", 0)),
        "last_rps": round(float(last.get("rps", 0) or 0), 2),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
