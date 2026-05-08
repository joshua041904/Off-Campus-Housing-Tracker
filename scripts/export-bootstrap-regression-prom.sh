#!/usr/bin/env bash
# bench_logs/bootstrap_regression_report.json → bench_logs/bootstrap_regression.prom
# Env: VERIFY_BOOTSTRAP_REGRESSION_REPORT, VERIFY_BOOTSTRAP_REGRESSION_PROM_OUT
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT="${VERIFY_BOOTSTRAP_REGRESSION_REPORT:-$ROOT/bench_logs/bootstrap_regression_report.json}"
OUT="${VERIFY_BOOTSTRAP_REGRESSION_PROM_OUT:-$ROOT/bench_logs/bootstrap_regression.prom}"

mkdir -p "$(dirname "$OUT")"

REPORT="$REPORT" OUT="$OUT" python3 <<'PY'
import json, os, re

report_path = os.environ["REPORT"]
out_path = os.environ["OUT"]
safe_phase = re.compile(r"^[A-Za-z0-9_.-]+$")
try:
    with open(report_path, encoding="utf-8") as fh:
        data = json.load(fh)
except FileNotFoundError:
    data = {"ok": True, "regressions": []}

regs = data.get("regressions") or []
if not isinstance(regs, list):
    regs = []

ok = bool(data.get("ok", True)) and len(regs) == 0
lines = [
    "# HELP bootstrap_regression_count Number of phases over REGRESSION_THRESHOLD * baseline p95.",
    "# TYPE bootstrap_regression_count gauge",
    f"bootstrap_regression_count {len(regs)}",
    "# HELP bootstrap_regression_ok 1 if no regression detected in last analysis.",
    "# TYPE bootstrap_regression_ok gauge",
    f"bootstrap_regression_ok {1 if ok else 0}",
    "# HELP bootstrap_regression_phase_ratio Current ms / baseline p95 for regressed phases.",
    "# TYPE bootstrap_regression_phase_ratio gauge",
]
for r in regs:
    if not isinstance(r, dict):
        continue
    ph = r.get("phase")
    ratio = r.get("ratio_vs_p95")
    if not isinstance(ph, str) or not safe_phase.match(ph):
        continue
    if isinstance(ratio, (int, float)) and not isinstance(ratio, bool):
        esc = ph.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'bootstrap_regression_phase_ratio{{phase="{esc}"}} {float(ratio)}')

with open(out_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")

print(out_path)
PY
