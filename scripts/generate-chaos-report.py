#!/usr/bin/env python3
"""
Aggregate chaos / forensics artifact dir into chaos-report.md (+ optional JSON sidecar).
Usage:
  python3 scripts/generate-chaos-report.py --dir bench_logs/chaos-20260404 --out bench_logs/chaos-20260404/chaos-report.md
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, required=True, help="Artifact directory (chaos run root)")
    ap.add_argument("--out", type=Path, default=None, help="Markdown output (default: <dir>/chaos-report.md)")
    ap.add_argument("--scenario", type=str, default="manual / suite run")
    args = ap.parse_args()

    d: Path = args.dir
    if not d.is_dir():
        print(f"dir missing: {d}", file=__import__("sys").stderr)
        return 1

    out = args.out or (d / "chaos-report.md")
    lines: list[str] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines.append("# Chaos / resilience report\n")
    lines.append(f"Generated: `{now}`  \n")
    lines.append(f"Artifact dir: `{d}`  \n")
    lines.append(f"Scenario: **{args.scenario}**\n\n")

    lines.append("## 1. Summary\n\n")
    lines.append("Automated stub — replace with MTTR / score after wiring Prometheus and chaos suite.\n\n")

    lines.append("## 2. Files discovered\n\n")
    for pat in ("*.json", "*.log", "*.md", "*.csv", "*.txt"):
        for p in sorted(d.rglob(pat)):
            if p.name.startswith("chaos-report") and p.suffix == ".md":
                continue
            try:
                rel = p.relative_to(d)
            except ValueError:
                rel = p
            lines.append(f"- `{rel}` ({p.stat().st_size} bytes)\n")

    lines.append("\n## 3. Transport summary (if present)\n\n")
    ts = d / "transport-summary.json"
    if not ts.is_file():
        ts = d / "forensics" / "network-cc" / "transport-summary.json"
    if ts.is_file():
        try:
            data = json.loads(ts.read_text())
            lines.append("```json\n")
            lines.append(json.dumps(data, indent=2)[:8000])
            lines.append("\n```\n\n")
        except json.JSONDecodeError:
            lines.append("(parse error)\n\n")
    else:
        lines.append("_No transport-summary.json found._\n\n")

    lines.append("## 4. Recommendations\n\n")
    lines.append("- Ensure **CPU requests** on HPA-managed Deployments.\n")
    lines.append("- Soften **readiness** during TLS rotation (failureThreshold / initialDelay).\n")
    lines.append("- Run `make verify-kafka-cluster` after broker events.\n\n")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(lines))
    meta = d / "chaos-report-meta.json"
    meta.write_text(
        json.dumps({"generated_at": now, "markdown": str(out), "scenario": args.scenario}, indent=2) + "\n"
    )
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
