#!/usr/bin/env python3
"""
Compare two `kubectl get pods -A -o json` snapshots; emit restart deltas as CSV.
Optional PNG if matplotlib is installed.

Usage:
  python3 scripts/generate-restart-timeline.py pods-before.json pods-after.json \\
    --csv-out bench_logs/run-x/restart-timeline.csv \\
    --png-out bench_logs/run-x/restart-timeline.png
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def restarts_by_key(doc: dict) -> dict[tuple[str, str, str], int]:
    out: dict[tuple[str, str, str], int] = {}
    for item in doc.get("items") or []:
        ns = (item.get("metadata") or {}).get("namespace") or ""
        pod = (item.get("metadata") or {}).get("name") or ""
        for cs in item.get("status", {}).get("containerStatuses") or []:
            name = cs.get("name") or ""
            rc = int(cs.get("restartCount") or 0)
            out[(ns, pod, name)] = rc
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("before_json", type=Path)
    ap.add_argument("after_json", type=Path)
    ap.add_argument("--csv-out", type=Path, required=True)
    ap.add_argument("--png-out", type=Path, default=None)
    args = ap.parse_args()

    if not args.before_json.is_file() or not args.after_json.is_file():
        print("missing before/after json", file=sys.stderr)
        return 1

    b = json.loads(args.before_json.read_text())
    a = json.loads(args.after_json.read_text())
    rb = restarts_by_key(b)
    ra = restarts_by_key(a)
    keys = sorted(set(rb) | set(ra))
    rows: list[tuple[str, str, str, int]] = []
    for k in keys:
        delta = ra.get(k, 0) - rb.get(k, 0)
        if delta != 0:
            rows.append((k[0], k[1], k[2], delta))

    args.csv_out.parent.mkdir(parents=True, exist_ok=True)
    with args.csv_out.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["namespace", "pod", "container", "restart_delta"])
        w.writerows(rows)
    print(f"Wrote {args.csv_out} ({len(rows)} deltas)")

    if args.png_out and rows:
        try:
            import matplotlib

            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            print("matplotlib not installed; skip PNG", file=sys.stderr)
            return 0

        # Simple bar: top 15 by delta
        rows.sort(key=lambda r: -abs(r[3]))
        top = rows[:15]
        labels = [f"{r[0][:8]}/{r[1][:20]}" for r in top]
        vals = [r[3] for r in top]
        plt.figure(figsize=(10, 5))
        plt.barh(labels[::-1], vals[::-1], color="steelblue")
        plt.xlabel("Restart delta (after - before)")
        plt.title("Pod restart delta during preflight window")
        plt.tight_layout()
        args.png_out.parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(args.png_out, dpi=120)
        plt.close()
        print(f"Wrote {args.png_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
