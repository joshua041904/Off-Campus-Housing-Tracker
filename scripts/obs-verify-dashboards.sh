#!/usr/bin/env bash
# Validate Grafana dashboard PromQL against live Prometheus; fail on required dead metrics.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec node "$ROOT/scripts/obs-verify-dashboards.mjs" "$@"
