#!/usr/bin/env bash
# Phase wall-clock timings (ms) → bench_logs/bootstrap_phase_timings.json — sourced from bootstrap-cluster.sh
# Requires: REPO_ROOT, python3

# Wall clock ms (stdout). Use as $(_och_bootstrap_ms_now) — inside $((…)) a bare _och_bootstrap_ms_now is a variable name, not a call (breaks with set -u).
_och_bootstrap_ms_now() {
  python3 -c "import time; print(int(time.time()*1000))"
}

_och_bootstrap_timing_json() {
  echo "${REPO_ROOT}/bench_logs/bootstrap_phase_timings.json"
}

_och_bootstrap_record_phase_timing_ms() {
  local phase="${1:?phase}"
  local ms="${2:?ms}"
  mkdir -p "${REPO_ROOT}/bench_logs"
  local f
  f="$(_och_bootstrap_timing_json)"
  PHASE="$phase" MS="$ms" FILE="$f" python3 <<'PY'
import json, os

path = os.environ["FILE"]
ph = os.environ["PHASE"]
ms = int(os.environ["MS"])
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except FileNotFoundError:
    data = {}
if not isinstance(data, dict):
    data = {}
data[ph] = ms
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY
}

_och_bootstrap_errors_dir() {
  echo "${REPO_ROOT}/bench_logs/bootstrap_errors"
}

# Write a host-side error snippet for a DAG node (path safe for logs).
_och_bootstrap_write_phase_error_log() {
  local node="${1:?node}"
  local title="${2:-error}"
  local out
  mkdir -p "$(_och_bootstrap_errors_dir)"
  out="$(_och_bootstrap_errors_dir)/${node}.log"
  {
    echo "ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ") node=${node} title=${title}"
    echo "---"
  } >"$out"
  echo "$out"
}
