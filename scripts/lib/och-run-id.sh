#!/usr/bin/env bash
# Stable bootstrap / verifier run id (low cardinality).
# Writes bench_logs/bootstrap_run_id.txt when created; reuses existing file in same run.
set -euo pipefail

_och_run_id_file() {
  local root="${1:-}"
  [[ -n "$root" ]] || root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  echo "${root}/bench_logs/bootstrap_run_id.txt"
}

och_ensure_run_id() {
  local root="${1:-}"
  [[ -n "$root" ]] || root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local f
  f="$(_och_run_id_file "$root")"
  mkdir -p "$(dirname "$f")"
  if [[ -f "$f" ]] && [[ -s "$f" ]]; then
    tr -d ' \n\r\t' <"$f" | head -c 64
    return 0
  fi
  local id="run_$(date -u +%Y%m%dT%H%M%SZ)"
  printf '%s\n' "$id" >"$f"
  printf '%s' "$id"
}

och_read_run_id() {
  local root="${1:-}"
  [[ -n "$root" ]] || root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local f
  f="$(_och_run_id_file "$root")"
  if [[ -f "$f" ]] && [[ -s "$f" ]]; then
    tr -d ' \n\r\t' <"$f" | head -c 64
    return 0
  fi
  och_ensure_run_id "$root"
}
