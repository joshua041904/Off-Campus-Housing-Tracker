#!/usr/bin/env bash
# Emit suite wall-clock gauges from bench_logs/*-last-timing.json → .prom and optional Pushgateway.
#
# Usage:
#   bash scripts/export-och-wall-clock-prom.sh cold-bootstrap
#   bash scripts/export-och-wall-clock-prom.sh preflight-lab coverage-phase-vi2-verify
#
# Metrics:
#   och_bootstrap_wall_clock_seconds{phase="cold-bootstrap"}
#   och_preflight_lab_wall_clock_seconds
#   och_coverage_phase_vi2_verify_wall_clock_seconds
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p bench_logs

# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"
RUN_ID="$(och_read_run_id)"

slug_for_suite() {
  case "$1" in
    cold-bootstrap) echo "cold-bootstrap" ;;
    preflight-lab | preflight-strict) echo "preflight-lab" ;;
    coverage-phase-vi2-verify) echo "coverage-phase-vi2-verify" ;;
    *) echo "$1" | tr ' /' '--' | tr -cd 'a-zA-Z0-9._-' ;;
  esac
}

metric_for_suite() {
  case "$1" in
    cold-bootstrap) echo "och_bootstrap_wall_clock_seconds" ;;
    preflight-lab | preflight-strict) echo "och_preflight_lab_wall_clock_seconds" ;;
    coverage-phase-vi2-verify) echo "och_coverage_phase_vi2_verify_wall_clock_seconds" ;;
    *) echo "och_suite_wall_clock_seconds" ;;
  esac
}

OUT="${OCH_WALL_CLOCK_PROM_OUT:-$ROOT/bench_logs/och-wall-clock.prom}"
: >"$OUT"
{
  echo "# HELP och_bootstrap_wall_clock_seconds Wall-clock seconds for bootstrap-related suites."
  echo "# TYPE och_bootstrap_wall_clock_seconds gauge"
  echo "# HELP och_preflight_lab_wall_clock_seconds Wall-clock seconds for make preflight-lab."
  echo "# TYPE och_preflight_lab_wall_clock_seconds gauge"
  echo "# HELP och_coverage_phase_vi2_verify_wall_clock_seconds Wall-clock seconds for coverage:phase-vi2-verify."
  echo "# TYPE och_coverage_phase_vi2_verify_wall_clock_seconds gauge"
  echo "# HELP och_suite_wall_clock_seconds Generic suite wall clock (phase label)."
  echo "# TYPE och_suite_wall_clock_seconds gauge"
  echo "# HELP och_command_wall_clock_seconds Wall clock for a wrapped command (run-with-wall-timer JSON)."
  echo "# TYPE och_command_wall_clock_seconds gauge"
  echo "# HELP och_command_success 1 when wrapped command exit_code is 0."
  echo "# TYPE och_command_success gauge"
  echo "# HELP och_bootstrap_run_info Active bootstrap run id (value 1)."
  echo "# TYPE och_bootstrap_run_info gauge"
  echo "och_bootstrap_run_info{run_id=\"${RUN_ID}\"} 1"
} >>"$OUT"

for suite in "$@"; do
  slug="$(slug_for_suite "$suite")"
  json="$ROOT/bench_logs/${slug}-last-timing.json"
  [[ -f "$json" ]] || json="$ROOT/bench_logs/$(echo "$suite" | tr ' /' '-' | tr -cd 'a-zA-Z0-9._-')-last-timing.json"
  sec=0
  exit_code="0"
  if [[ -f "$json" ]]; then
    sec="$(python3 - "$json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    d = json.load(fh)
ms = d.get("duration_ms")
if isinstance(ms, (int, float)):
    print(int(round(ms / 1000.0)))
else:
    print(int(d.get("duration_sec", 0) or 0))
PY
)"
    exit_code="$(python3 - "$json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    d = json.load(fh)
print(int(d.get("exit_code", 0)))
PY
)"
  fi
  cmd_label="$(echo "$suite" | tr ' /' '-' | tr -cd 'a-zA-Z0-9._-')"
  [[ "$cmd_label" == "" ]] && cmd_label="$slug"
  succ=0
  [[ "$exit_code" == "0" ]] && succ=1
  echo "och_command_wall_clock_seconds{command=\"${cmd_label}\",run_id=\"${RUN_ID}\"} ${sec}" >>"$OUT"
  echo "och_command_success{command=\"${cmd_label}\",exit_code=\"${exit_code}\",run_id=\"${RUN_ID}\"} ${succ}" >>"$OUT"
  mname="$(metric_for_suite "$suite")"
  if [[ "$mname" == "och_bootstrap_wall_clock_seconds" ]]; then
    echo "${mname}{phase=\"${slug}\",run_id=\"${RUN_ID}\"} ${sec}" >>"$OUT"
  elif [[ "$mname" == "och_suite_wall_clock_seconds" ]]; then
    echo "${mname}{phase=\"${slug}\",run_id=\"${RUN_ID}\"} ${sec}" >>"$OUT"
  else
    echo "${mname}{run_id=\"${RUN_ID}\"} ${sec}" >>"$OUT"
  fi
done

echo "$OUT"

if [[ "${OCH_PUSH_WALL_CLOCK:-1}" == "1" ]]; then
  chmod +x "$ROOT/scripts/lib/push-och-prom.sh" 2>/dev/null || true
  OCH_PUSHGATEWAY_JOB="${OCH_PUSHGATEWAY_JOB:-och-wall-clock}" \
    OCH_PUSHGATEWAY_INSTANCE="${OCH_PUSHGATEWAY_INSTANCE:-$RUN_ID}" \
    bash "$ROOT/scripts/lib/push-och-prom.sh" "$OUT" || echo "push-och-prom (wall-clock): skipped or failed (non-fatal)" >&2
fi
