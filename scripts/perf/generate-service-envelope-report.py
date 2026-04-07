#!/usr/bin/env python3
"""
Read k6 handleSummary JSON files (one per endpoint run).
Used by scripts/perf/run-preflight-phase-d-tail-lab.sh when the service envelope lab runs (default; PREFLIGHT_SERVICE_ENVELOPE=0 skips).

Inputs: directory of *.json files with keys:
  service, endpoint, endpoint_name, rps, p95_ms, error_rate, threshold_breached (optional)

Outputs:
  service-envelope.csv            — all rows
  service-envelope-summary.csv  — one row per service (max RPS observed)
  service-envelope-<service>.png — RPS vs p95 (one subplot series per endpoint_name)

Dependencies: matplotlib (same venv pattern as kafka alignment report: make kafka-alignment-report-venv).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def load_rows(input_dir: Path) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(input_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        if not isinstance(data, dict):
            continue
        svc = data.get("service")
        if svc is None:
            continue
        p95_raw = data.get("p95_ms")
        err_r = float(data.get("error_rate") or 0)
        thr_p95 = data.get("envelope_threshold_p95_ms")
        thr_err = data.get("envelope_threshold_error_rate")
        tb = data.get("threshold_breached")
        if tb is None and thr_p95 is not None:
            p95_f = float(p95_raw) if p95_raw is not None else None
            thr_p95_f = float(thr_p95)
            thr_err_f = float(thr_err) if thr_err is not None else 0.05
            fail_r = data.get("http_req_failed_rate")
            fail_r_f = float(fail_r) if fail_r is not None else 0.0
            tb = (
                (p95_f is not None and p95_f >= thr_p95_f)
                or err_r >= thr_err_f
                or fail_r_f >= thr_err_f
            )
        elif tb is None:
            tb = False
        rows.append(
            {
                "service": str(svc),
                "endpoint_name": str(data.get("endpoint_name") or ""),
                "endpoint": str(data.get("endpoint") or ""),
                "rps": float(data.get("rps") or 0),
                "p95_ms": p95_raw,
                "error_rate": err_r,
                "threshold_breached": bool(tb),
            }
        )
    return rows


def write_detail_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "service",
                "endpoint_name",
                "endpoint",
                "rps",
                "p95_ms",
                "error_rate",
                "threshold_breached",
            ],
        )
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "service": r["service"],
                    "endpoint_name": r["endpoint_name"],
                    "endpoint": r["endpoint"],
                    "rps": f"{r['rps']:.6f}",
                    "p95_ms": "" if r["p95_ms"] is None else f"{float(r['p95_ms']):.4f}",
                    "error_rate": f"{r['error_rate']:.6f}",
                    "threshold_breached": "true" if r["threshold_breached"] else "false",
                }
            )


def write_summary_csv(path: Path, rows: list[dict]) -> None:
    """One row per service: endpoint row with highest observed RPS."""
    best: dict[str, dict] = {}
    for r in rows:
        svc = r["service"]
        if svc not in best or r["rps"] > best[svc]["rps"]:
            best[svc] = r
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "service",
                "endpoint_name",
                "endpoint",
                "rps",
                "p95_ms",
                "error_rate",
                "threshold_breached",
            ],
        )
        w.writeheader()
        for svc in sorted(best.keys()):
            b = best[svc]
            w.writerow(
                {
                    "service": b["service"],
                    "endpoint_name": b["endpoint_name"],
                    "endpoint": b["endpoint"],
                    "rps": f"{b['rps']:.6f}",
                    "p95_ms": "" if b["p95_ms"] is None else f"{float(b['p95_ms']):.4f}",
                    "error_rate": f"{b['error_rate']:.6f}",
                    "threshold_breached": "true" if b["threshold_breached"] else "false",
                }
            )


def plot_by_service(
    rows: list[dict], output_dir: Path, p95_threshold: float
) -> None:
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:
        print(
            "matplotlib not installed; skip PNG graphs. "
            "Install with: python3 -m pip install matplotlib "
            f"or use repo venv (see Makefile kafka-alignment-report-venv). ({e})",
            file=sys.stderr,
        )
        return

    by_svc: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_svc[r["service"]].append(r)

    output_dir.mkdir(parents=True, exist_ok=True)
    for svc, svc_rows in sorted(by_svc.items()):
        by_ep: dict[str, list[dict]] = defaultdict(list)
        for r in svc_rows:
            by_ep[r["endpoint_name"] or r["endpoint"]].append(r)

        plt.figure()
        for ep_key in sorted(by_ep.keys()):
            pts = sorted(by_ep[ep_key], key=lambda x: x["rps"])
            xs = [p["rps"] for p in pts]
            ys = [
                float(p["p95_ms"]) if p["p95_ms"] is not None else 0.0 for p in pts
            ]
            plt.plot(xs, ys, marker="o", linestyle="-", label=ep_key)

        plt.axhline(y=p95_threshold, linestyle="--", linewidth=1)
        plt.xlabel("RPS")
        plt.ylabel("p95 latency (ms)")
        plt.title(f"{svc} service envelope")
        plt.grid(True)
        plt.legend(loc="best", fontsize=8)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in svc)
        plt.savefig(output_dir / f"service-envelope-{safe}.png")
        plt.close()


def main() -> int:
    p = argparse.ArgumentParser(description="k6 service envelope CSV + graphs")
    p.add_argument("input_dir", type=Path, help="Directory of summary *.json files")
    p.add_argument("output_dir", type=Path, help="Directory for CSV + PNG")
    p.add_argument(
        "--p95-threshold",
        type=float,
        default=1200.0,
        help="Horizontal reference line on p95 charts (ms)",
    )
    args = p.parse_args()

    if not args.input_dir.is_dir():
        print(f"input_dir not a directory: {args.input_dir}", file=sys.stderr)
        return 1

    rows = load_rows(args.input_dir)
    if not rows:
        print("No valid JSON summaries found.", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_detail_csv(args.output_dir / "service-envelope.csv", rows)
    write_summary_csv(args.output_dir / "service-envelope-summary.csv", rows)
    plot_by_service(rows, args.output_dir, args.p95_threshold)
    print(f"Wrote {args.output_dir / 'service-envelope.csv'}")
    print(f"Wrote {args.output_dir / 'service-envelope-summary.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
