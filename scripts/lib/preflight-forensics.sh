#!/usr/bin/env bash
# Sourced by run-preflight-scale-and-all-suites.sh when pod snapshots / forensics enabled.
#
# Env:
#   PREFLIGHT_POD_SNAPSHOT=1     — kubectl get pods -A -o json before + after + restart-causes.txt + timeline CSV
#   PREFLIGHT_FORENSIC=1         — also run cluster-log-sweep + network-command-center (heavy)
#   PREFLIGHT_FAIL_ON_RECENT_RESTART=1 — exit 1 from finalize if terminated finishedAt within PREFLIGHT_RECENT_RESTART_WINDOW_SEC (default 7200)
# shellcheck shell=bash

_preflight_forensics_begin() {
  [[ -z "${PREFLIGHT_RUN_DIR:-}" ]] && return 0
  [[ "${PREFLIGHT_POD_SNAPSHOT:-0}" != "1" && "${PREFLIGHT_FORENSIC:-0}" != "1" ]] && return 0
  mkdir -p "${PREFLIGHT_RUN_DIR}/forensics"
  local fb="${PREFLIGHT_RUN_DIR}/pods-before.json"
  kubectl get pods -A -o json >"$fb" 2>/dev/null || echo '{"items":[]}' >"$fb"
  echo "PREFLIGHT_POD_SNAPSHOT_BEFORE=$fb"
}

_preflight_forensics_finalize() {
  [[ -z "${PREFLIGHT_RUN_DIR:-}" ]] && return 0
  [[ "${PREFLIGHT_POD_SNAPSHOT:-0}" != "1" && "${PREFLIGHT_FORENSIC:-0}" != "1" ]] && return 0

  local SCRIPT_DIR="${SCRIPT_DIR:-}"
  [[ -z "$SCRIPT_DIR" ]] && SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local REPO_ROOT="${REPO_ROOT:-}"
  [[ -z "$REPO_ROOT" ]] && REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

  mkdir -p "${PREFLIGHT_RUN_DIR}/forensics"
  local fa="${PREFLIGHT_RUN_DIR}/pods-after.json"
  kubectl get pods -A -o json >"$fa" 2>/dev/null || echo '{"items":[]}' >"$fa"
  echo ""
  echo "=== Preflight forensics (pod snapshots) ==="
  echo "PREFLIGHT_POD_SNAPSHOT_AFTER=$fa"

  local fb="${PREFLIGHT_RUN_DIR}/pods-before.json"
  if [[ -f "$fb" ]] && command -v jq >/dev/null 2>&1; then
    jq -r '
      .items[]? |
      .metadata.namespace as $ns |
      .metadata.name as $pod |
      .status.containerStatuses[]? |
      select(.restartCount > 0) |
      "\($ns)/\($pod) | \(.name) | restarts=\(.restartCount) | lastState=\(.lastState // {})"
    ' "$fa" >"${PREFLIGHT_RUN_DIR}/restart-causes-after.txt" 2>/dev/null || true
    echo "Restart summary (containers with restartCount>0, after run):"
    head -50 "${PREFLIGHT_RUN_DIR}/restart-causes-after.txt" 2>/dev/null || true
  fi

  if [[ -f "$REPO_ROOT/scripts/generate-restart-timeline.py" ]] && [[ -f "$fb" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 "$REPO_ROOT/scripts/generate-restart-timeline.py" "$fb" "$fa" \
        --csv-out "${PREFLIGHT_RUN_DIR}/restart-timeline.csv" \
        --png-out "${PREFLIGHT_RUN_DIR}/restart-timeline.png" 2>/dev/null || true
    fi
  fi

  if [[ "${PREFLIGHT_FORENSIC:-0}" == "1" ]]; then
    echo "PREFLIGHT_FORENSIC=1: forensic log sweep + cluster sweep + network command center (best-effort)…"
    FORENSIC_LOG_ROOT="${PREFLIGHT_RUN_DIR}" \
      FORENSIC_NAMESPACES="${PREFLIGHT_FORENSIC_NS:-off-campus-housing-tracker ingress-nginx}" \
      bash "$REPO_ROOT/scripts/forensic-log-sweep.sh" 2>/dev/null || true
    CLUSTER_SWEEP_OUT="${PREFLIGHT_RUN_DIR}/forensics/cluster-sweep.log" \
      SWEEP_NAMESPACES="${PREFLIGHT_FORENSIC_NS:-off-campus-housing-tracker ingress-nginx}" \
      bash "$REPO_ROOT/scripts/cluster-log-sweep.sh" 2>/dev/null || true
    NETWORK_CC_OUT="${PREFLIGHT_RUN_DIR}/forensics/network-cc" \
      bash "$REPO_ROOT/scripts/network-command-center.sh" 2>/dev/null || true
  fi

  # Optional: fail if recent termination (finishedAt within window)
  if [[ "${PREFLIGHT_FAIL_ON_RECENT_RESTART:-0}" == "1" ]] && command -v jq >/dev/null 2>&1; then
    local win="${PREFLIGHT_RECENT_RESTART_WINDOW_SEC:-7200}"
    local now
    now=$(date +%s)
    local bad=0
    while IFS= read -r line; do
      local ts
      ts=$(echo "$line" | jq -r '.finishedAt // empty' 2>/dev/null || true)
      [[ -z "$ts" ]] && continue
      local ft=0
      if [[ "$(uname -s)" == "Darwin" ]]; then
        ft=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || echo 0)
      else
        ft=$(date -d "$ts" +%s 2>/dev/null || echo 0)
      fi
      [[ "$ft" -eq 0 ]] && continue
      if (( now - ft < win )); then
        echo "RECENT_RESTART: finishedAt=$ts (within ${win}s)"
        bad=1
      fi
    done < <(jq -c '.items[]?.status?.containerStatuses[]?.lastState?.terminated? // empty' "$fa" 2>/dev/null || true)
    if [[ "$bad" -eq 1 ]]; then
      echo "❌ PREFLIGHT_FAIL_ON_RECENT_RESTART=1: recent termination in window" >&2
      return 1
    fi
  fi
  return 0
}
