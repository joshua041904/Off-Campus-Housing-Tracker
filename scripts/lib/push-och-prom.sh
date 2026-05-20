#!/usr/bin/env bash
# Push Prometheus text exposition to Pushgateway (host or in-cluster).
# Logging goes to stderr only — stdout must stay empty (verify-app-runtime / verify-bootstrap-state JSON).
#
# Usage:
#   OCH_PUSHGATEWAY_JOB=bootstrap OCH_PUSHGATEWAY_INSTANCE=run_20260515T120000Z \
#     bash scripts/lib/push-och-prom.sh bench_logs/app_runtime_metrics.prom
#
# Env:
#   PUSHGATEWAY_URL — override base URL (default: in-cluster svc via port-forward)
#   OCH_PUSHGATEWAY_JOB — job label (required for grouping)
#   OCH_PUSHGATEWAY_INSTANCE — instance label (default: run id or timestamp)
#   OCH_PUSH_SKIP=1 — no-op success
set -euo pipefail

if [[ "${OCH_PUSH_SKIP:-0}" == "1" ]]; then
  echo "push-och-prom: OCH_PUSH_SKIP=1 — skip" >&2
  exit 0
fi

[[ "$#" -ge 1 ]] || {
  echo "usage: push-och-prom.sh <file.prom> [more.prom ...]" >&2
  exit 2
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"

JOB="${OCH_PUSHGATEWAY_JOB:?set OCH_PUSHGATEWAY_JOB}"
INSTANCE="${OCH_PUSHGATEWAY_INSTANCE:-$(och_read_run_id "$ROOT")}"
NS="${OCH_OBSERVABILITY_NS:-observability}"

_push_curl() {
  local base="$1" job="$2" instance="$3" body_file="$4"
  local url="${base%/}/metrics/job/${job}/instance/${instance}"
  curl -fsS --connect-timeout 5 --max-time 30 --data-binary @"$body_file" "$url"
}

_merge_prom_files() {
  local out="$1"
  shift
  : >"$out"
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    grep -v '^#' "$f" 2>/dev/null | grep -E '.+' >>"$out" || true
  done
}

_resolve_push_base() {
  if [[ -n "${PUSHGATEWAY_URL:-}" ]]; then
    echo "${PUSHGATEWAY_URL%/}"
    return 0
  fi
  if kubectl get svc -n "$NS" pushgateway --request-timeout=5s &>/dev/null; then
    echo "http://127.0.0.1:${OCH_PUSHGATEWAY_LOCAL_PORT:-19091}"
    return 0
  fi
  return 1
}

_push_with_port_forward() {
  local body="$1"
  local pf_port="${OCH_PUSHGATEWAY_LOCAL_PORT:-19091}"
  kubectl port-forward -n "$NS" "svc/pushgateway" "${pf_port}:9091" >/dev/null 2>&1 &
  local pf_pid=$!
  local ok=0
  for _ in $(seq 1 20); do
    if curl -fsS --connect-timeout 1 "http://127.0.0.1:${pf_port}/-/ready" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ok" != "1" ]]; then
    kill "$pf_pid" 2>/dev/null || true
    wait "$pf_pid" 2>/dev/null || true
    return 1
  fi
  _push_curl "http://127.0.0.1:${pf_port}" "$JOB" "$INSTANCE" "$body" || ok=0
  kill "$pf_pid" 2>/dev/null || true
  wait "$pf_pid" 2>/dev/null || true
  [[ "$ok" == "1" ]]
}

TMP="$(mktemp "${TMPDIR:-/tmp}/och-push-prom.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
_merge_prom_files "$TMP" "$@"

if [[ ! -s "$TMP" ]]; then
  echo "push-och-prom: no metric lines in input — skip" >&2
  exit 0
fi

{
  echo "# pushed_at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat "$TMP"
} >"${TMP}.body"
mv "${TMP}.body" "$TMP"

BASE="$(_resolve_push_base)" || {
  echo "push-och-prom: pushgateway not reachable (set PUSHGATEWAY_URL or deploy observability pushgateway)" >&2
  exit 1
}

if [[ "$BASE" =~ ^http://127\.0\.0\.1: ]] || [[ "$BASE" =~ ^http://localhost: ]]; then
  _push_with_port_forward "$TMP"
else
  _push_curl "$BASE" "$JOB" "$INSTANCE" "$TMP"
fi

echo "push-och-prom: pushed job=${JOB} instance=${INSTANCE} ($(wc -l <"$TMP" | tr -d ' ') lines)" >&2
