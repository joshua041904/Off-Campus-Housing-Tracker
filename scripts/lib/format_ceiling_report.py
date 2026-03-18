#!/usr/bin/env python3
"""
Format transport_ceiling_report.json as publishable Markdown (and optional methodology).
Use for docs, handoffs, or external reporting.
"""
import json
import sys
from pathlib import Path


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


METHODOLOGY = """
## Methodology

- **Load:** k6 with xk6-http3, strict H3 (H2_RATE=0, STRICT_H3=1), ramp by VUs.
- **Break condition:** error_rate > 1%, timeout_rate > 1%, or p95 > 5× average latency.
- **Knee (v2 robust):** Sustained efficiency drop (< 60% of max) for 3 consecutive steps with no recovery (>30% RPS) in next 2 steps. Transient collapses that recover are classified as runtime instability, not knee.
- **Runtime instability:** RPS drop >50% with recovery >50% within 2 steps and latency spike >5× baseline → scheduler/harness noise, not structural.
- **Bottleneck:** Classified from ramp shape and optional pcap (no_quic_listener vs cpu vs network).
- **Transport validation:** Packet proof via tshark on pcap: QUIC version, ALPN h3, no HTTP/2 frames in strict H3 run. Empty or invalid pcap → validated=false.
- **Little's Law:** λ = RPS (from step), W = avg latency (s), L = λ×W; utilization = L/VUs.
- **Environment:** Colima/K3s, MetalLB LoadBalancer, Caddy ingress (QUIC+TLS 1.3). Single-node or multi-node per run.
"""


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    report_path = root / "transport_ceiling_report.json"
    report = load_json(report_path)
    if not report:
        sys.stderr.write(f"No report at {report_path}\n")
        sys.exit(1)

    out_path = root / "transport_ceiling_report.md"
    with_methodology = "--methodology" in sys.argv or "-m" in sys.argv

    lines = [
        "# Transport Ceiling Report",
        "",
        "| Field | Value |",
        "|-------|-------|",
    ]

    def row(label: str, value: object) -> str:
        v = value if value is not None else "—"
        return f"| {label} | {v} |"

    # Support both flat and schema v2 (transport_validation, performance, runtime_analysis, littles_law, scheduler)
    tv = report.get("transport_validation") or {}
    perf = report.get("performance") or report
    runtime = report.get("runtime_analysis") or {}
    ll = report.get("littles_law") or {}
    sched = report.get("scheduler") or {}

    lines.append(row("Transport validated", tv.get("validated", report.get("transport_validated"))))
    lines.append(row("ALPN", tv.get("alpn", report.get("alpn", "unknown"))))
    lines.append(row("QUIC version", tv.get("quic_version", report.get("quic_version"))))
    lines.append(row("TLS 1.3 only", report.get("tls13_only", True)))
    lines.append(row("HTTP/2 detected (strict H3 run)", tv.get("http2_detected", report.get("http2_detected", False))))
    lines.append(row("H3 max RPS", perf.get("h3_max_rps", report.get("h3_max_rps"))))
    lines.append(row("Knee (VUs)", perf.get("knee_vus", report.get("knee_vus"))))
    lines.append(row("Knee (RPS)", perf.get("knee_rps", report.get("knee_rps"))))
    lines.append(row("P95 at knee (ms)", perf.get("p95_at_knee", report.get("p95_at_knee"))))
    lines.append(row("Plateau detected", perf.get("plateau_detected", report.get("plateau_detected"))))
    lines.append(row("Congestion bound", perf.get("bound", report.get("congestion_bound"))))
    lines.append(row("Runtime instability detected", runtime.get("runtime_instability_detected")))
    if runtime.get("instability_steps"):
        lines.append(row("Instability steps (VUs)", runtime.get("instability_steps")))
    if ll:
        lines.append(row("Little's Law λ (rps)", ll.get("lambda_rps")))
        lines.append(row("Little's Law L (inflight)", ll.get("inflight_concurrency") or ll.get("inflight_concurrency_estimate")))
        lines.append(row("Utilization %", ll.get("utilization_percent") or ll.get("concurrency_utilization_percent")))
    if sched:
        lines.append(row("Scheduler CV", sched.get("coefficient_of_variation")))
        lines.append(row("Scheduler contention", sched.get("contention_detected", report.get("scheduler_contention", {}).get("scheduler_contention_detected"))))
    delta_bbr = report.get("bbr_vs_cubic_delta_percent")
    if delta_bbr is not None:
        lines.append(row("BBR vs CUBIC delta (%)", delta_bbr))
    delta_metallb = report.get("metallb_vs_nodeport_delta_percent")
    if delta_metallb is not None:
        lines.append(row("MetalLB vs NodePort delta (%)", delta_metallb))

    lines.extend(["", ""])
    if with_methodology:
        lines.append(METHODOLOGY.strip())
        lines.append("")

    md = "\n".join(lines)
    with open(out_path, "w") as f:
        f.write(md)
    print(md)
    print(f"\nWrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
