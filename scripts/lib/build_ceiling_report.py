#!/usr/bin/env python3
"""
Build transport_ceiling_report.json from ramp steps + knee detection + validation + bottleneck.
Optionally merge BBR vs CUBIC and MetalLB vs NodePort deltas. v2: efficiency curve, plateau, Little's Law, scheduler contention.
"""
import json
import math
import sys
from pathlib import Path


def load_json(path: Path) -> dict | list:
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    steps_path = root / "ramp_steps.json"
    knee_path = root / "knee_result.json"
    validation_path = root / "transport_validation.json"
    bottleneck_path = root / "bottleneck_result.json"
    comparison_path = root / "transport_comparison_input.json"
    experiment_path = root / "experiment_metadata.json"

    steps = load_json(steps_path)
    if isinstance(steps, dict):
        steps = steps.get("steps", steps.get("ramp_steps", []))
    if not steps:
        steps = []

    knee_result = load_json(knee_path)
    knee = knee_result.get("knee") if isinstance(knee_result, dict) else knee_result
    validation = load_json(validation_path)
    if not isinstance(validation, dict):
        validation = {}
    bottleneck_data = load_json(bottleneck_path)
    bottleneck_class = bottleneck_data.get("bottleneck_class", "cpu") if isinstance(bottleneck_data, dict) else "cpu"
    transport_state = bottleneck_data.get("transport_state", "saturated") if isinstance(bottleneck_data, dict) else "saturated"

    max_rps = max((float(s.get("rps", 0) or 0) for s in steps), default=0)
    last = steps[-1] if steps else {}

    # Normalize quic_version for display (validator may return list if multiple versions)
    qv = validation.get("quic_version")
    if isinstance(qv, list) and qv:
        qv = qv[0]
    elif not isinstance(qv, (str, type(None))):
        qv = str(qv) if qv is not None else None

    report = {
        "transport_validated": validation.get("valid", False),
        "tls13_only": validation.get("tls13_only", True),
        "alpn": "h3" if validation.get("alpn_h3") else "unknown",
        "http2_detected": (validation.get("http2_frames") or 0) > 0,
        "quic_version": qv,
        "udp_errors": validation.get("udp_errors", 0),
        "h3_max_rps": round(max_rps, 2),
        "knee_vus": knee.get("knee_vus") if knee else None,
        "knee_rps": knee.get("knee_rps") if knee else None,
        "p95_at_knee": knee.get("p95_at_knee_ms") if knee else None,
        "congestion_bound": bottleneck_class,
        "transport_state": transport_state,
        "bbr_vs_cubic_delta_percent": None,
        "metallb_vs_nodeport_delta_percent": None,
    }

    comp = load_json(comparison_path)
    if isinstance(comp, dict):
        report["bbr_vs_cubic_delta_percent"] = comp.get("bbr_vs_cubic_delta_percent")
        report["metallb_vs_nodeport_delta_percent"] = comp.get("metallb_vs_nodeport_delta_percent")

    # v2: efficiency curve and plateau from knee_result (v2 knee detector)
    if isinstance(knee_result, dict):
        if "efficiency_curve" in knee_result:
            report["efficiency_curve"] = knee_result["efficiency_curve"]
        if "plateau_detected" in knee_result:
            report["plateau_detected"] = knee_result["plateau_detected"]
    if isinstance(bottleneck_data, dict) and "bound_confidence" in bottleneck_data:
        report["bound_confidence"] = bottleneck_data.get("bound_confidence")

    # Little's Law: L = λ × W (λ = RPS, W = avg latency sec, L = in-flight concurrency)
    if steps:
        # Use step with max RPS for capacity interpretation
        best = max(steps, key=lambda s: float(s.get("rps") or 0))
        rps = float(best.get("rps") or 0)
        lat = best.get("latency_ms") or best
        avg_ms = float(lat.get("avg") or lat.get("avg_ms") or 0)
        vus = int(best.get("vus") or 0)
        w_sec = avg_ms / 1000.0 if avg_ms else 0
        L = round(rps * w_sec, 2) if w_sec else None
        util = round(L / vus * 100, 2) if (L is not None and vus) else None
        report["littles_law"] = {
            "lambda_rps": round(rps, 2),
            "avg_latency_sec": round(w_sec, 6),
            "inflight_concurrency_estimate": L,
            "concurrency_utilization_percent": util,
        }

    # Scheduler contention: coefficient of variation of p95 across steps
    if len(steps) >= 3:
        p95_list = []
        for s in steps:
            lat = s.get("latency_ms") or s
            p95_list.append(float(lat.get("p95") or lat.get("p95_ms") or 0))
        if p95_list:
            mean_p95 = sum(p95_list) / len(p95_list)
            var = sum((x - mean_p95) ** 2 for x in p95_list) / len(p95_list)
            std = math.sqrt(var)
            cv = (std / mean_p95) if mean_p95 else 0
            report["scheduler_contention"] = {
                "latency_variance": round(var, 4),
                "coefficient_of_variation": round(cv, 4),
                "scheduler_contention_detected": cv > 0.5,
            }

    if experiment_path.exists():
        report["experiment"] = load_json(experiment_path)

    out_path = root / "transport_ceiling_report.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    print(f"\nWrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
