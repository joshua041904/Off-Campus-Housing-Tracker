#!/usr/bin/env bash
# Emit Prometheus exposition lines for node CPU/memory from `kubectl top nodes` (requires metrics-server).
set -euo pipefail
if ! command -v kubectl >/dev/null 2>&1; then
  exit 0
fi
if ! kubectl top nodes --no-headers >/dev/null 2>&1; then
  exit 0
fi

echo "# och_bootstrap node headroom (kubectl top nodes) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
kubectl top nodes --no-headers | awk '
NF >= 5 {
  name = $1
  cp = $3
  gsub(/%/, "", cp)
  mp = $5
  gsub(/%/, "", mp)
  if (cp !~ /^[0-9]+$/) next
  if (mp !~ /^[0-9]+$/) next
  idle = 100 - cp + 0
  memfree = 100 - mp + 0
  gsub(/[^a-zA-Z0-9._-]/, "_", name)
  printf "och_bootstrap_node_cpu_usage_percent{node=\"%s\"} %s\n", name, cp
  printf "och_bootstrap_node_mem_usage_percent{node=\"%s\"} %s\n", name, mp
  printf "och_bootstrap_node_cpu_idle_percent{node=\"%s\"} %d\n", name, idle
  printf "och_bootstrap_node_mem_free_percent{node=\"%s\"} %d\n", name, memfree
}'
