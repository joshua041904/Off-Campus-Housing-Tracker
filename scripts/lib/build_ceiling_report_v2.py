#!/usr/bin/env python3
"""
Build transport_ceiling_report.json — Schema v2.1.
Structure: schema_version, transport_validation, performance, runtime_analysis, littles_law, scheduler, experiment.
All blocks always present with all keys; null means unavailable. No "N/A" strings. No empty objects.
Sources: ramp_steps.json, knee_result.json, transport_validation.json, bottleneck_result.json, experiment_metadata.json.
"""
import json
import math
import sys
from pathlib import Path

SCHEMA_VERSION = "2.1"
SUPPORTED_SCHEMA_VERSIONS = {"2.1"}

# Canonical keys for each block; setdefault(k, None) enforces shape.
TRANSPORT_TEMPLATE = {
    "validated": None,
    "quic_version": None,
    "alpn": None,
    "http2_detected": None,
    "quic_packet_count": None,
    "quic_1rtt_packets": None,
    "quic_initial_packets": None,
    "quic_loss_rate_estimated": None,
    "handshake_rtt_ms_estimated": None,
    "quic_retry_detected": None,
    "quic_packet_size_stats": None,
    "transport_proof_sha256": None,
    "transport_confidence_score": None,
    "transport_confidence_breakdown": None,
    "validation_note": None,
    "error": None,
}
PERFORMANCE_TEMPLATE = {
    "h3_max_rps": None,
    "knee_vus": None,
    "knee_rps": None,
    "p95_at_knee": None,
    "plateau_detected": None,
    "bound": None,
}
RUNTIME_ANALYSIS_TEMPLATE = {
    "runtime_instability_detected": None,
    "instability_steps": None,
}
LITTLES_LAW_TEMPLATE = {
    "lambda_rps": None,
    "avg_latency_sec": None,
    "inflight_concurrency": None,
    "utilization_percent": None,
}
SCHEDULER_TEMPLATE = {
    "coefficient_of_variation": None,
    "contention_detected": None,
}
CLUSTER_TEMPLATE = {"node_count": None, "ready_count": None, "server_version": None}
SYSCTL_KEYS = [
    "net.ipv4.tcp_congestion_control",
    "net.core.default_qdisc",
    "net.ipv4.tcp_slow_start_after_idle",
]
EXPERIMENT_TEMPLATE = {
    "timestamp_utc": None,
    "git_commit": None,
    "git_branch": None,
    "k6_version": None,
    "cluster": None,
    "sysctl": None,
    "config_file": None,
    "experiment_uuid": None,
    "reproducibility_hash": None,
}


def normalize_block(block: dict, template: dict) -> dict:
    """Ensure every template key exists in block; missing keys get None."""
    for k in template:
        block.setdefault(k, None)
    return block


def assert_no_na(obj: object) -> None:
    """Raise if any string value is 'N/A'. CI gate for schema discipline."""
    if isinstance(obj, dict):
        for v in obj.values():
            assert_no_na(v)
    elif isinstance(obj, list):
        for v in obj:
            assert_no_na(v)
    else:
        if obj == "N/A":
            raise ValueError("Report contains forbidden string 'N/A'")


def load_json(path: Path) -> dict | list:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            data = f.read()
        if not data.strip():
            return {}
        return json.loads(data)
    except (json.JSONDecodeError, OSError):
        return {}


def main() -> None:
    root = Path(sys.argv[1]).expanduser().absolute() if len(sys.argv) > 1 else Path.cwd()
    validation_path = root / "transport_validation.json"
    steps_path = root / "ramp_steps.json"
    knee_path = root / "knee_result.json"
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

    max_rps = max((float(s.get("rps", 0) or 0) for s in steps), default=0)

    qv = validation.get("quic_version")
    if isinstance(qv, list) and qv:
        qv = qv[0]
    elif not isinstance(qv, (str, type(None))):
        qv = str(qv) if qv is not None else None

    validated = validation.get("valid", validation.get("validated", False))
    alpn = "h3" if validation.get("alpn_h3") else (validation.get("alpn_protocol") or None)
    http2_detected = validation.get("http2_detected", (validation.get("http2_frames") or 0) > 0)
    validation_note = validation.get("validation_note")
    confidence_score = validation.get("transport_confidence_score")
    if confidence_score is None:
        confidence_score = 0

    transport_validation = normalize_block(
        {
            "validated": validated,
            "quic_version": qv,
            "alpn": alpn,
            "http2_detected": http2_detected,
            "quic_packet_count": validation.get("quic_packet_count"),
            "quic_1rtt_packets": validation.get("quic_1rtt_packets"),
            "quic_initial_packets": validation.get("quic_initial_packets"),
            "quic_loss_rate_estimated": validation.get("quic_loss_rate_estimated"),
            "handshake_rtt_ms_estimated": validation.get("handshake_rtt_ms_estimated"),
            "quic_retry_detected": validation.get("quic_retry_detected"),
            "quic_packet_size_stats": validation.get("quic_packet_size_stats"),
            "transport_proof_sha256": validation.get("transport_proof_sha256"),
            "transport_confidence_score": confidence_score,
            "transport_confidence_breakdown": validation.get("transport_confidence_breakdown"),
            "validation_note": validation_note,
            "error": validation.get("error") if not validated else None,
        },
        TRANSPORT_TEMPLATE,
    )

    performance = normalize_block(
        {
            "h3_max_rps": round(max_rps, 2),
            "knee_vus": knee.get("knee_vus") if knee else None,
            "knee_rps": knee.get("knee_rps") if knee else None,
            "p95_at_knee": knee.get("p95_at_knee_ms") if knee else None,
            "plateau_detected": knee_result.get("plateau_detected") if isinstance(knee_result, dict) else None,
            "bound": bottleneck_class,
        },
        PERFORMANCE_TEMPLATE,
    )

    runtime_analysis = normalize_block(
        {
            "runtime_instability_detected": knee_result.get("runtime_instability_detected")
            if isinstance(knee_result, dict)
            else None,
            "instability_steps": knee_result.get("instability_steps", []) if isinstance(knee_result, dict) else [],
        },
        RUNTIME_ANALYSIS_TEMPLATE,
    )

    littles_law = dict(LITTLES_LAW_TEMPLATE)
    if steps:
        best = max(steps, key=lambda s: float(s.get("rps") or 0))
        lambda_rps = float(best.get("rps") or 0)
        lat = best.get("latency_ms") or best
        avg_ms = float(lat.get("avg") or lat.get("avg_ms") or 0)
        vus = int(best.get("vus") or 0)
        w_sec = avg_ms / 1000.0 if avg_ms else 0
        L = round(lambda_rps * w_sec, 2) if w_sec else None
        util = round(L / vus * 100, 2) if (L is not None and vus) else None
        littles_law["lambda_rps"] = round(lambda_rps, 2)
        littles_law["avg_latency_sec"] = round(w_sec, 6)
        littles_law["inflight_concurrency"] = L
        littles_law["utilization_percent"] = util
    else:
        littles_law = normalize_block(littles_law, LITTLES_LAW_TEMPLATE)

    scheduler = dict(SCHEDULER_TEMPLATE)
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
            scheduler["coefficient_of_variation"] = round(cv, 4)
            scheduler["contention_detected"] = cv > 0.5
    scheduler = normalize_block(scheduler, SCHEDULER_TEMPLATE)

    comp = load_json(comparison_path)
    bbr_delta = comp.get("bbr_vs_cubic_delta_percent") if isinstance(comp, dict) else None
    metallb_delta = comp.get("metallb_vs_nodeport_delta_percent") if isinstance(comp, dict) else None

    experiment_raw = load_json(experiment_path) if experiment_path.exists() else {}
    experiment = dict(EXPERIMENT_TEMPLATE)
    if isinstance(experiment_raw, dict):
        for k in EXPERIMENT_TEMPLATE:
            if k in experiment_raw:
                experiment[k] = experiment_raw[k]
        if experiment.get("cluster") is None:
            experiment["cluster"] = normalize_block({}, CLUSTER_TEMPLATE)
        elif isinstance(experiment["cluster"], dict):
            experiment["cluster"] = normalize_block(dict(experiment["cluster"]), CLUSTER_TEMPLATE)
        sysctl_val = experiment.get("sysctl")
        if sysctl_val is None or not isinstance(sysctl_val, dict):
            experiment["sysctl"] = {k: None for k in SYSCTL_KEYS}
        else:
            out_sysctl = {}
            for k in SYSCTL_KEYS:
                v = sysctl_val.get(k)
                if v == "N/A":
                    v = None
                out_sysctl[k] = v
            experiment["sysctl"] = out_sysctl
    else:
        experiment["cluster"] = normalize_block({}, CLUSTER_TEMPLATE)
        experiment["sysctl"] = {k: None for k in SYSCTL_KEYS}

    report = {
        "schema_version": SCHEMA_VERSION,
        "transport_validation": transport_validation,
        "performance": performance,
        "runtime_analysis": runtime_analysis,
        "littles_law": littles_law,
        "scheduler": scheduler,
        "bbr_vs_cubic_delta_percent": bbr_delta,
        "metallb_vs_nodeport_delta_percent": metallb_delta,
        "experiment": experiment,
    }

    assert_no_na(report)

    version = report.get("schema_version")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        raise RuntimeError(f"Incompatible schema version: {version}")

    schema_path = root / "schemas" / "transport_ceiling_report.v2.1.schema.json"
    if not schema_path.exists():
        schema_path = root.parent / "schemas" / "transport_ceiling_report.v2.1.schema.json"
    if schema_path.exists():
        try:
            from jsonschema import validate as jsonschema_validate

            schema = json.loads(schema_path.read_text())
            jsonschema_validate(instance=report, schema=schema)
        except ImportError:
            pass

    out_path = root / "transport_ceiling_report.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    print(f"\nWrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
