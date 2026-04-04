#!/usr/bin/env python3
"""Parse kafka-alignment-suite.sh logs → CSV + optional PNG (matplotlib)."""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

ROW_RE = re.compile(
    r"^KAFKA_ALIGNMENT_TEST test=(?P<name>\S+) status=(?P<status>\S+) duration_sec=(?P<dur>[\d.]+)"
)


def parse_log(log_path: Path) -> list[tuple[str, str, float]]:
    rows: list[tuple[str, str, float]] = []
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        print(f"Cannot read log: {e}", file=sys.stderr)
        return rows
    for line in text.splitlines():
        m = ROW_RE.match(line.strip())
        if not m:
            continue
        try:
            dur = float(m.group("dur"))
        except ValueError:
            dur = 0.0
        rows.append((m.group("name"), m.group("status"), dur))
    return rows


def write_csv(path: Path, rows: list[tuple[str, str, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["test_name", "status", "duration_sec"])
        for name, status, dur in rows:
            w.writerow([name, status, f"{dur:.3f}"])
    print(f"Wrote {path} ({len(rows)} rows)")


def write_png(path: Path, rows: list[tuple[str, str, float]]) -> None:
    if not rows:
        print("No rows for PNG; skip", file=sys.stderr)
        return
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skip PNG", file=sys.stderr)
        return

    labels = [r[0][:32] for r in rows]
    # 1 = pass/skip (green), 0 = fail (red) — map status to height for bar visibility
    heights = [1.0 if r[1] in ("PASS", "SKIP") else 0.0 for r in rows]
    colors = ["#2e7d32" if h > 0.5 else "#c62828" for h in heights]
    fig, ax = plt.subplots(figsize=(10, max(4, len(rows) * 0.35)))
    y = range(len(rows))
    ax.barh(list(y), heights, color=colors, tick_label=labels)
    ax.set_xlim(0, 1.15)
    ax.set_xlabel("Pass (1) / Fail (0)")
    ax.set_title("Kafka alignment suite — pass/fail by test")
    ax.invert_yaxis()
    plt.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(path, dpi=120)
    plt.close()
    print(f"Wrote {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--log", type=Path, required=True, help="Suite log file")
    ap.add_argument("--out-dir", type=Path, required=True, help="Output directory (e.g. bench_logs/kafka-alignment-report)")
    ap.add_argument("--stamp", default="", help="Timestamp suffix for filenames")
    args = ap.parse_args()
    stamp = args.stamp or "latest"
    rows = parse_log(args.log)
    out_dir = args.out_dir
    csv_path = out_dir / f"kafka-alignment-suite-{stamp}.csv"
    png_path = out_dir / f"kafka-alignment-suite-{stamp}.png"
    write_csv(csv_path, rows)
    write_png(png_path, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
