#!/usr/bin/env bash
# Legacy entry: cold-bootstrap now embeds scripts/run-with-wall-timer.sh (bench_logs/cold-bootstrap-last-timing.json).
# This script forwards to `make cold-bootstrap` so old CI/docs keep working without double-timing.
#
# Optional: time an arbitrary command instead:
#   bash scripts/run-cold-bootstrap-with-timer.sh bash -c 'echo hi'
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 [arguments…]  (default: forwards to make cold-bootstrap)" >&2
  exit 2
fi
# If invoked exactly as historical CI: `.../run-cold-bootstrap-with-timer.sh make cold-bootstrap`
if [[ "$#" -ge 2 && "$1" == *make* && "$2" == "cold-bootstrap" ]]; then
  exec make cold-bootstrap
fi
exec "$ROOT/scripts/run-with-wall-timer.sh" "custom-$(date +%H%M%S)" "$@"
