#!/usr/bin/env bash
# Parse K6_TRACE_ID lines from a k6 log, fetch each trace from Jaeger Query, run validate-trace-contract.mjs.
#
# Jaeger Query (v1): GET {base}/api/traces/{traceId}  — NOT ?traceID= (that returns 400).
#
# Usage:
#   JAEGER_QUERY_BASE=http://127.0.0.1:16686 bash scripts/validate-k6-traces.sh [k6.log]
#
# Env:
#   K6_TRACE_JAEGER_FETCH_ATTEMPTS — default 15 (indexing + OTLP batch delay)
#   K6_TRACE_JAEGER_FETCH_SLEEP_SEC — default 2
#   TRACE_CONTRACT_* — passed through validate-trace-contract.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${1:-$ROOT/bench_logs/k6-trace-contract.log}"
if [[ ! -f "$LOG" ]]; then
  echo "validate-k6-traces: log not found: $LOG"
  exit 1
fi
if [[ -z "${JAEGER_QUERY_BASE:-}" ]] && [[ -f "$ROOT/bench_logs/.jaeger-query-base" ]]; then
  _jb="$(tr -d '\r\n' <"$ROOT/bench_logs/.jaeger-query-base" | sed 's/[[:space:]]*$//')"
  [[ -n "$_jb" ]] && export JAEGER_QUERY_BASE="$_jb"
fi
if [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  echo "validate-k6-traces: JAEGER_QUERY_BASE required (or write bench_logs/.jaeger-query-base)"
  exit 1
fi
BASE_Q="${JAEGER_QUERY_BASE%/}"
export TRACE_CONTRACT_REQUIRE_ALL_SERVICES="${TRACE_CONTRACT_REQUIRE_ALL_SERVICES:-1}"
export TRACE_LATENCY_BUDGETS_FILE="${TRACE_LATENCY_BUDGETS_FILE:-$ROOT/infra/trace_latency_budgets.json}"

_ATTEMPTS="${K6_TRACE_JAEGER_FETCH_ATTEMPTS:-15}"
_SLEEP="${K6_TRACE_JAEGER_FETCH_SLEEP_SEC:-2}"
_MIN_SPANS="${K6_TRACE_MIN_SPANS:-8}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# k6 often logs structured lines (level=info msg="K6_TRACE_ID <hex32>"); awk '{print $2}' breaks → invalid id → Jaeger HTTP 400.
sed -n 's/.*K6_TRACE_ID[^0-9A-Fa-f]*\([0-9a-fA-F]\{32\}\).*/\1/p' "$LOG" | tr '[:upper:]' '[:lower:]' | sort -u >"$tmp" || true
if [[ ! -s "$tmp" ]]; then
  echo "validate-k6-traces: no 32-hex trace ids after K6_TRACE_ID in $LOG"
  echo "  Expected lines containing: K6_TRACE_ID <32 lowercase hex chars>"
  exit 1
fi

_fetch_http_body() {
  local tid="$1"
  local out="$2"
  # Correct Jaeger API: path segment trace id (see https://www.jaegertracing.io/docs/latest/apis/#http-json-internal)
  curl -sS --max-time 45 -o "$out" -w "%{http_code}" "${BASE_Q}/api/traces/${tid}"
}

_trace_has_enough_spans() {
  local json="$1"
  node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const t = Array.isArray(j.data) && j.data[0] ? j.data[0] : (j.traceID && j.spans ? j : null);
const n = t && Array.isArray(t.spans) ? t.spans.length : 0;
process.exit(n >= Number(process.argv[2]) ? 0 : 1);
" "$json" "$_MIN_SPANS"
}

while read -r tid_raw; do
  [[ -z "$tid_raw" ]] && continue
  tid="$tid_raw"
  out="$ROOT/bench_logs/k6_trace_${tid}.json"
  echo "▶ validate-k6-traces: Jaeger GET ${BASE_Q}/api/traces/${tid}"

  ok=0
  for ((i = 1; i <= _ATTEMPTS; i++)); do
    http="$(_fetch_http_body "$tid" "$out" || printf '%s' "000")"
    if [[ "$http" == "200" ]]; then
      if _trace_has_enough_spans "$out"; then
        echo "  HTTP 200 + spans ≥${_MIN_SPANS} (attempt $i/${_ATTEMPTS})"
        ok=1
        break
      fi
      echo "  HTTP 200 but trace sparse or not merged yet (attempt $i/${_ATTEMPTS}), sleep ${_sleep}s"
    else
      echo "  HTTP $http from Jaeger (attempt $i/${_ATTEMPTS}), sleep ${_sleep}s"
      if [[ -s "$out" ]]; then
        echo "  body (first 300 bytes):" >&2
        head -c 300 "$out" >&2 || true
        echo >&2
      fi
    fi
    sleep "$_sleep"
  done

  if [[ "$ok" != "1" ]]; then
    echo "::error::validate-k6-traces: no usable trace for id=$tid after ${_ATTEMPTS} attempts (URL path must be /api/traces/<32-hex-lower>)"
    exit 1
  fi

  node "$ROOT/scripts/validate-trace-contract.mjs" "$out"
done <"$tmp"

echo "✅ all k6 traces passed contract"
