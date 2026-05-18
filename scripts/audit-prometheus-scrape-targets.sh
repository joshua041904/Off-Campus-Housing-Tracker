#!/usr/bin/env bash
# Print Prometheus activeTargets summary (expects port-forward to 127.0.0.1:19090/prometheus).
set -euo pipefail
PROM="${PROMETHEUS_URL:-http://127.0.0.1:19090/prometheus}"
curl -s "${PROM%/}/api/v1/targets" \
  | jq '.data.activeTargets[] | {job: .labels.job, service: .labels.service, health: .health, lastError: .lastError, scrapeUrl: .scrapeUrl}'
