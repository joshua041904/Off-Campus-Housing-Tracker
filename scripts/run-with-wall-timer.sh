#!/usr/bin/env bash
# Wall-clock timer for long Make suites (cold-bootstrap, preflight-strict, preflight-lab, …).
# Prints Xm Ys to stdout and writes bench_logs/<suite-slug>-last-timing.json.
#
# Bash-only ([[ ]], BASH_SOURCE). Do not run with dash/sh — use: bash scripts/run-with-wall-timer.sh …
#
# Usage:
#   bash scripts/run-with-wall-timer.sh cold-bootstrap make cold-bootstrap-run
#   bash scripts/run-with-wall-timer.sh preflight-lab make _preflight-lab-inner
#
# Env:
#   TIMER_JSON_OUT — override output path (default derived from suite name)
# Guard must run before `set -o pipefail` so dash does not die on an obscure option error.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "error: $0 requires bash (not dash/sh)" >&2
  exit 2
fi
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p bench_logs

[[ "$#" -ge 2 ]] || {
  echo "usage: $0 <suite-name> <command...>" >&2
  exit 2
}

SUITE="$1"
shift
_slug="${SUITE// /-}"
_slug="${_slug//\//-}"
_slug="${_slug//[^a-zA-Z0-9._-]/_}"

START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== [${SUITE}] wall timer start (${START_ISO}) ==="

# Never use the name RC here: some environments export/unset RC or treat it oddly under `set -u`.
# Capture $? on the same line as the timed command so nothing can clobber the status.
_wall_timer_exit=0
set +e
"$@"; _wall_timer_exit=$?
set -e

END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
END_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUR=$((END_MS - START_MS))
TOTAL_SEC=$((DUR / 1000))
MIN=$((TOTAL_SEC / 60))
SEC=$((TOTAL_SEC % 60))

echo "=== [${SUITE}] wall timer done: ${MIN}m ${SEC}s (${DUR} ms), exit=${_wall_timer_exit} (${END_ISO}) ==="

JSON_OUT="${TIMER_JSON_OUT:-$ROOT/bench_logs/${_slug}-last-timing.json}"
SUITE_WALL_TIMER_EXIT="${_wall_timer_exit}"
export JSON_OUT SUITE SUITE_WALL_TIMER_EXIT DUR START_ISO END_ISO MIN SEC TOTAL_SEC
python3 <<'PY'
import json, os

ms = int(os.environ["DUR"])
ts = int(os.environ["TOTAL_SEC"])
doc = {
    "kind": "suite_wall_timer",
    "suite": os.environ["SUITE"],
    "exit_code": int(os.environ["SUITE_WALL_TIMER_EXIT"]),
    "started_iso": os.environ["START_ISO"],
    "finished_iso": os.environ["END_ISO"],
    "duration_ms": ms,
    "duration_sec": round(ms / 1000.0, 3),
    "duration_minutes": int(os.environ["MIN"]),
    "duration_seconds_remainder": int(os.environ["SEC"]),
    "duration_human": f"{int(os.environ['MIN'])}m {int(os.environ['SEC'])}s",
}
path = os.environ["JSON_OUT"]
with open(path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(f"Timing JSON: {path}")
PY

exit "${_wall_timer_exit}"
