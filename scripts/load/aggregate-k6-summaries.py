#!/usr/bin/env python3
"""
Merge k6 --summary-export JSON files in a directory into:
  - latency-report.md  (p50, p95, p99, max / p100 per run)
  - latency-graph.html (bar chart of p95 & max per service)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def extract_duration_values(summary: dict) -> dict[str, float | None]:
    m = summary.get("metrics") or {}
    dur = m.get("http_req_duration") or m.get("http_req_duration{expected_response:true}")
    if not isinstance(dur, dict):
        return {}
    vals = dur.get("values")
    if not isinstance(vals, dict):
        return {}
    out: dict[str, float | None] = {}
    for k, v in vals.items():
        try:
            if v is None:
                out[k] = None
            elif isinstance(v, (int, float)):
                out[k] = float(v)
            else:
                out[k] = float(v)
        except (TypeError, ValueError):
            out[k] = None
    return out


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: aggregate-k6-summaries.py <output_dir>", file=sys.stderr)
        sys.exit(2)
    out_dir = Path(sys.argv[1])
    rows: list[tuple[str, dict[str, float | None]]] = []
    for path in sorted(out_dir.glob("*-summary.json")):
        name = path.name.replace("-summary.json", "")
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        vals = extract_duration_values(data)
        if vals:
            rows.append((name, vals))

    md = out_dir / "latency-report.md"
    lines = [
        "# k6 latency rollup (all services)",
        "",
        "| run | avg (ms) | med | p(95) | p(99) | max (p100) |",
        "|-----|----------|-----|-------|-------|------------|",
    ]
    chart_labels: list[str] = []
    chart_p95: list[float] = []
    chart_max: list[float] = []

    for name, vals in rows:
        def ms(k: str) -> str:
            v = vals.get(k)
            if v is None:
                return "—"
            return f"{v:.2f}"

        avg = ms("avg")
        med = ms("med")
        p95 = ms("p(95)")
        p99 = ms("p(99)")
        mx = ms("max")
        lines.append(f"| {name} | {avg} | {med} | {p95} | {p99} | {mx} |")
        chart_labels.append(name)
        try:
            chart_p95.append(float(vals.get("p(95)") or 0))
        except (TypeError, ValueError):
            chart_p95.append(0.0)
        try:
            chart_max.append(float(vals.get("max") or 0))
        except (TypeError, ValueError):
            chart_max.append(0.0)

    lines.extend(["", "_max is k6’s worst sample (treat as empirical p100)._"])
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    html = out_dir / "latency-graph.html"
    html.write_text(
        """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>k6 latency by service run</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{font-family:system-ui,sans-serif;background:#1c1917;color:#e7e5e4;margin:24px;}
h1{font-size:1.25rem;}
canvas{max-height:420px;}
</style></head><body>
<h1>HTTP request duration — p(95) vs max (empirical p100)</h1>
<p>Generated from k6 <code>--summary-export</code> JSON files in this folder.</p>
<canvas id="c"></canvas>
<script>
const labels = %s;
const p95 = %s;
const maxv = %s;
new Chart(document.getElementById('c'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'p(95) ms', data: p95, backgroundColor: 'rgba(245, 158, 11, 0.7)' },
      { label: 'max ms', data: maxv, backgroundColor: 'rgba(120, 113, 108, 0.8)' },
    ],
  },
  options: {
    responsive: true,
    scales: {
      x: { ticks: { color: '#a8a29e' }, grid: { color: '#44403c' } },
      y: { beginAtZero: true, ticks: { color: '#a8a29e' }, grid: { color: '#44403c' }, title: { display: true, text: 'ms', color: '#78716c' } },
    },
    plugins: { legend: { labels: { color: '#d6d3d1' } } },
  },
});
</script>
</body></html>"""
        % (
            json.dumps(chart_labels),
            json.dumps(chart_p95),
            json.dumps(chart_max),
        ),
        encoding="utf-8",
    )
    print(f"Wrote {md} and {html} ({len(rows)} runs)")


if __name__ == "__main__":
    main()
