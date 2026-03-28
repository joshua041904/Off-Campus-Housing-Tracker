#!/usr/bin/env bash
# Sequential k6 runs for core service flows across protocol modes.
# Writes per-protocol per-service summary JSON + protocol-comparison/service-latency/raw-metrics under protocol-matrix/.
#
# HTTP/3 leg uses the same binary resolution as run-k6-phases.sh / preflight 6d:
#   K6_HTTP3_BIN (if set and executable), then .k6-build/bin/k6-http3, .k6-build/k6-http3,
#   then .xk6-build/bin/k6-http3, .xk6-build/k6-http3.
# Build once: ./scripts/build-k6-http3.sh → see docs/XK6_HTTP3_SETUP.md
#
# Usage (repo root):
#   SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-k6-protocol-matrix.sh
#
# Single cell (wrapper / cert / binary debug — same env as full matrix):
#   ./scripts/load/run-k6-protocol-matrix.sh http3 gateway
#   ./scripts/load/run-k6-protocol-matrix.sh http2 auth
# Trust-only higher-VU compare (http1 then http2 + optional pg_stat_activity polling):
#   DURATION=45s VUS=12 ./scripts/load/run-trust-protocol-stress.sh
#
# Env:
#   PREFLIGHT_RUN_DIR     — if set, matrix goes to $PREFLIGHT_RUN_DIR/protocol-matrix
#   K6_MATRIX_OUT         — override output directory
#   K6_MATRIX_SERVICES    — comma list of service ids (default: gateway,auth,listings,booking,trust,analytics,messaging,media,event-layer)
#   K6_MATRIX_DURATION    — per-script duration override (default 20s)
#   K6_MATRIX_VUS         — per-script VUs override (default 6)
#   K6_HTTP3_BIN          — explicit path to xk6-http3 (overrides search)
#   K6_MATRIX_ENSURE_HTTP3=1 — if no binary found, run scripts/build-k6-http3.sh then re-resolve
#   SKIP_HTTP3=1          — skip QUIC leg
#   K6_HTTP3_NO_REUSE     — default 1 for the http3 leg (Colima/host QUIC reuse timeouts)
#   K6_MATRIX_STRICT=1    — any non-zero k6 exit fails the cell (default 0: tolerate known xk6-http3 teardown panic)
#   K6_HTTP2_DISABLE_REUSE=1 — passed to k6 env; scripts that honor it (e.g. k6-messaging.js) set noVUConnectionReuse
#
# Each k6 run appends to k6-matrix-logs/<proto>-<service>.log: k6 version, planned env, full stdout/stderr,
# exit_code. When k6 exits non-zero but produced a valid summary (e.g. threshold exit 99), keep metrics and
# annotate with k6_matrix_status/k6_matrix_warning (unless K6_MATRIX_STRICT=1).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Portable absolute paths for matrix logs (macOS + Linux).
_och_realpath() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || echo "$1"
}

# Resolve k6 binary to an absolute path (PATH lookup or path with a slash).
_och_k6_abs() {
  local e="$1"
  if [[ "$e" == /* || "$e" == */* ]]; then
    if [[ -x "$e" ]]; then
      _och_realpath "$e"
      return
    fi
  fi
  local w
  w=$(command -v "$e" 2>/dev/null || true)
  if [[ -n "$w" ]]; then
    _och_realpath "$w"
    return
  fi
  echo "$e"
}

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"

OUT="${K6_MATRIX_OUT:-}"
if [[ -z "$OUT" ]]; then
  if [[ -n "${PREFLIGHT_RUN_DIR:-}" ]]; then
    OUT="$PREFLIGHT_RUN_DIR/protocol-matrix"
  else
    STAMP=$(date +%Y%m%d-%H%M%S)
    OUT="$REPO_ROOT/bench_logs/run-$STAMP/protocol-matrix"
  fi
fi
mkdir -p "$OUT/http2" "$OUT/http1" "$OUT/http3"

K6_SCRIPT="${K6_SCRIPT:-$REPO_ROOT/scripts/load/k6-gateway-health.js}"
H3_SCRIPT="$REPO_ROOT/scripts/load/k6-gateway-health-http3.js"
K6_BIN="${K6_BIN:-k6}"
K6_MATRIX_DURATION="${K6_MATRIX_DURATION:-${DURATION:-20s}}"
# VU / duration parity: http1, http2, and http3 legs all use the same K6_MATRIX_VUS + K6_MATRIX_DURATION (fair collapse comparison).
K6_MATRIX_VUS="${K6_MATRIX_VUS:-${VUS:-6}}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

declare -A SERVICE_SCRIPT=(
  ["gateway"]="$REPO_ROOT/scripts/load/k6-gateway-health.js"
  ["auth"]="$REPO_ROOT/scripts/load/k6-auth-service-health.js"
  ["listings"]="$REPO_ROOT/scripts/load/k6-listings-health.js"
  ["booking"]="$REPO_ROOT/scripts/load/k6-booking-health.js"
  ["trust"]="$REPO_ROOT/scripts/load/k6-trust-public.js"
  ["analytics"]="$REPO_ROOT/scripts/load/k6-analytics-public.js"
  ["messaging"]="$REPO_ROOT/scripts/load/k6-messaging.js"
  ["media"]="$REPO_ROOT/scripts/load/k6-media-health.js"
  ["event-layer"]="$REPO_ROOT/scripts/load/k6-event-layer-adversarial.js"
)
SERVICES_RAW="${K6_MATRIX_SERVICES:-gateway,auth,listings,booking,trust,analytics,messaging,media,event-layer}"
IFS=',' read -r -a SERVICES <<<"$SERVICES_RAW"

resolve_xk6_http3() {
  HTTP3_BIN=""
  if [[ -n "${K6_HTTP3_BIN:-}" ]] && [[ -x "${K6_HTTP3_BIN}" ]]; then
    HTTP3_BIN="$K6_HTTP3_BIN"
    return 0
  fi
  for candidate in \
    "$REPO_ROOT/.k6-build/bin/k6-http3" \
    "$REPO_ROOT/.k6-build/k6-http3" \
    "$REPO_ROOT/.xk6-build/bin/k6-http3" \
    "$REPO_ROOT/.xk6-build/k6-http3"
  do
    [[ -x "$candidate" ]] || continue
    HTTP3_BIN="$candidate"
    return 0
  done
  return 1
}

# After k6 exits: strict mode always writes error JSON on rc!=0; else preserve valid summaries and annotate warnings.
k6_matrix_handle_exit() {
  local rc="$1" log="$2" sum="$3" proto="$4" svc="$5" rel="$6"
  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi
  local strict="${K6_MATRIX_STRICT:-0}"
  if [[ "$strict" == "1" || "$strict" == "true" ]]; then
    printf '%s\n' "{\"error\":\"k6 exited ${rc}\",\"protocol\":\"${proto}\",\"service\":\"${svc}\",\"log\":\"${rel}\"}" >"$sum"
    return 0
  fi

  if [[ -f "$sum" ]] && jq empty "$sum" 2>/dev/null && jq -e '.metrics != null' "$sum" >/dev/null 2>&1; then
    local tmp
    tmp=$(mktemp)
    # k6 commonly exits 99 when thresholds are crossed. Keep summary metrics and mark status/warning.
    if grep -q "thresholds on metrics" "$log" 2>/dev/null; then
      if jq --arg w "k6 thresholds crossed; metrics preserved (exit ${rc})" \
        --argjson ex "$rc" \
        '. + {k6_matrix_warning: $w, k6_matrix_status: "thresholds_crossed_with_metrics", k6_matrix_exit_code: $ex}' \
        "$sum" >"$tmp" 2>/dev/null && mv "$tmp" "$sum"; then
        {
          echo "---"
          echo "k6_matrix_handle_exit: exit ${rc} treated as thresholds_crossed_with_metrics"
        } >>"$log"
        return 0
      fi
      rm -f "$tmp"
    fi

    if grep -q "github.com/bandorko/xk6-http3" "$log" 2>/dev/null && grep -qE "panic:|SIGSEGV" "$log" 2>/dev/null; then
      local fr
      fr=$(jq -r '(.metrics.http_req_failed.values.rate // .metrics["http_req_failed"].values.rate) // empty' "$sum" 2>/dev/null || echo "")
      [[ -z "$fr" ]] && fr="0"
      if awk -v x="$fr" 'BEGIN{ if (x+0 <= 0.05) exit 0; exit 1 }' 2>/dev/null; then
        if jq --arg w "xk6-http3 teardown panic (non-fatal); k6 exited ${rc} after scenario completed" \
          --argjson ex "$rc" \
          '. + {k6_matrix_warning: $w, k6_matrix_status: "success_with_teardown_warning", k6_matrix_exit_code: $ex}' \
          "$sum" >"$tmp" 2>/dev/null && mv "$tmp" "$sum"; then
          {
            echo "---"
            echo "k6_matrix_handle_exit: exit ${rc} treated as success_with_teardown_warning (xk6-http3 teardown)"
          } >>"$log"
          return 0
        fi
        rm -f "$tmp"
      fi
    fi

    # Any other non-zero exit with a valid summary: keep metrics and annotate status.
    tmp=$(mktemp)
    if jq --arg w "k6 exited ${rc} but produced summary metrics; preserving summary" \
      --argjson ex "$rc" \
      '. + {k6_matrix_warning: $w, k6_matrix_status: "nonzero_exit_with_metrics", k6_matrix_exit_code: $ex}' \
      "$sum" >"$tmp" 2>/dev/null && mv "$tmp" "$sum"; then
      {
        echo "---"
        echo "k6_matrix_handle_exit: exit ${rc} preserved as nonzero_exit_with_metrics"
      } >>"$log"
      return 0
    fi
    rm -f "$tmp"
  fi

  printf '%s\n' "{\"error\":\"k6 exited ${rc}\",\"protocol\":\"${proto}\",\"service\":\"${svc}\",\"log\":\"${rel}\"}" >"$sum"
}

HTTP3_BIN=""
if ! resolve_xk6_http3; then
  if [[ "${K6_MATRIX_ENSURE_HTTP3:-0}" == "1" ]] && [[ -f "$REPO_ROOT/scripts/build-k6-http3.sh" ]]; then
    say "K6_MATRIX_ENSURE_HTTP3=1 — running ./scripts/build-k6-http3.sh (xk6 + xk6-http3)..."
    (cd "$REPO_ROOT" && chmod +x scripts/build-k6-http3.sh 2>/dev/null && ./scripts/build-k6-http3.sh) || true
    resolve_xk6_http3 || true
  fi
fi

# Run k6 for one matrix cell: append header + full stdout/stderr to k6-matrix-logs/<proto>-<svc>.log.
# Only if k6 exits non-zero, write error JSON to summary path (real process failure — not a silent wrapper swallow).
k6_matrix_exec() {
  local proto="$1"
  local svc="$2"
  local script="$3"
  local k6exe="$4"

  local sum="$OUT/$proto/${svc}-summary.json"
  local rel="k6-matrix-logs/${proto}-${svc}.log"
  local log="$OUT/$rel"
  mkdir -p "$OUT/k6-matrix-logs"

  if [[ ! -f "$script" ]]; then
    printf '%s\n' '{"error":"missing script"}' >"$sum"
    return 0
  fi

  local sum_abs script_abs k6_abs ssl_abs tls_abs ca_abs
  sum_abs=$(_och_realpath "$sum")
  script_abs=$(_och_realpath "$script")
  k6_abs=$(_och_k6_abs "$k6exe")
  ssl_abs=""
  [[ -n "${SSL_CERT_FILE:-}" ]] && ssl_abs=$(_och_realpath "${SSL_CERT_FILE}")
  tls_abs=""
  [[ -n "${K6_TLS_CA_CERT:-}" ]] && tls_abs=$(_och_realpath "${K6_TLS_CA_CERT}")
  ca_abs=""
  [[ -n "${K6_CA_ABSOLUTE:-}" ]] && ca_abs=$(_och_realpath "${K6_CA_ABSOLUTE}")

  local exact_repro=""
  case "$proto" in
    http2)
      exact_repro=$(printf 'cd %q && env DURATION=%q VUS=%q PROTOCOL_MODE=http2 K6_PROTOCOL=http2 PROTOCOL=http2 K6_HTTP2_DISABLE_REUSE=%q SSL_CERT_FILE=%q K6_TLS_CA_CERT=%q K6_CA_ABSOLUTE=%q %q run --summary-export %q %q' \
        "$REPO_ROOT" "$K6_MATRIX_DURATION" "$K6_MATRIX_VUS" "${K6_HTTP2_DISABLE_REUSE:-0}" "$ssl_abs" "$tls_abs" "$ca_abs" "$k6_abs" "$sum_abs" "$script_abs")
      ;;
    http1)
      exact_repro=$(printf 'cd %q && env GODEBUG=http2client=0 DURATION=%q VUS=%q PROTOCOL_MODE=http1 K6_PROTOCOL=http1 PROTOCOL=http1 K6_HTTP2_DISABLE_REUSE=%q SSL_CERT_FILE=%q K6_TLS_CA_CERT=%q K6_CA_ABSOLUTE=%q %q run --summary-export %q %q' \
        "$REPO_ROOT" "$K6_MATRIX_DURATION" "$K6_MATRIX_VUS" "${K6_HTTP2_DISABLE_REUSE:-0}" "$ssl_abs" "$tls_abs" "$ca_abs" "$k6_abs" "$sum_abs" "$script_abs")
      ;;
    http3)
      exact_repro=$(printf 'cd %q && env DURATION=%q VUS=%q PROTOCOL_MODE=http3 K6_PROTOCOL=http3 PROTOCOL=http3 K6_HTTP3_REQUIRE_MODULE=1 K6_HTTP3_NO_REUSE=%q SSL_CERT_FILE=%q K6_TLS_CA_CERT=%q K6_CA_ABSOLUTE=%q %q run --summary-export %q %q' \
        "$REPO_ROOT" "$K6_MATRIX_DURATION" "$K6_MATRIX_VUS" "${K6_HTTP3_NO_REUSE:-1}" "$ssl_abs" "$tls_abs" "$ca_abs" "$k6_abs" "$sum_abs" "$script_abs")
      ;;
  esac

  {
    echo "======== $(date -u +%Y-%m-%dT%H:%M:%SZ) protocol=${proto} service=${svc} ========"
    echo "repo_root=$REPO_ROOT"
    echo "k6_executable_passed=$k6exe"
    echo "k6_path_resolved=$k6_abs"
    echo "SSL_CERT_FILE=$SSL_CERT_FILE"
    echo "SSL_CERT_FILE_resolved=$ssl_abs"
    echo "K6_TLS_CA_CERT=${K6_TLS_CA_CERT:-}"
    echo "K6_TLS_CA_CERT_resolved=$tls_abs"
    echo "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE:-}"
    echo "K6_CA_ABSOLUTE_resolved=$ca_abs"
    echo "summary_export=$sum_abs"
    echo "script=$script_abs"
    if [[ "$proto" == "http3" && "$svc" == "gateway" ]]; then
      echo "NOTE: http3+gateway uses xk6-http3 + k6-gateway-health-http3.js (not stock k6 + k6-gateway-health.js)."
    fi
    echo "--- connection / reuse (reporting) ---"
    echo "K6_MATRIX_STRICT=${K6_MATRIX_STRICT:-0}"
    echo "K6_HTTP3_NO_REUSE=${K6_HTTP3_NO_REUSE:-} (http3 env; QUIC path uses extension behavior)"
    echo "K6_HTTP2_DISABLE_REUSE=${K6_HTTP2_DISABLE_REUSE:-0} (http1/http2; k6-messaging.js sets noVUConnectionReuse when 1)"
    echo "Note: stock k6 does not emit maxConnections or tls handshake counts in end-of-run summary; see k6.io/docs for options."
    echo "--- k6 version ($k6_abs) ---"
    "$k6exe" version 2>&1 | head -12 || true
    echo "--- exact_reproduce (copy-paste after exports match) ---"
    echo "$exact_repro"
    echo "--- k6 stdout/stderr (combined) ---"
  } >>"$log"

  local rc=0
  set +e
  case "$proto" in
    http2)
      env \
        DURATION="$K6_MATRIX_DURATION" \
        VUS="$K6_MATRIX_VUS" \
        PROTOCOL_MODE=http2 \
        K6_PROTOCOL=http2 \
        PROTOCOL=http2 \
        K6_HTTP2_DISABLE_REUSE="${K6_HTTP2_DISABLE_REUSE:-0}" \
        SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
        K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-}" \
        K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-}" \
        "$k6exe" run --summary-export "$sum" "$script" >>"$log" 2>&1
      rc=$?
      ;;
    http1)
      env \
        GODEBUG=http2client=0 \
        DURATION="$K6_MATRIX_DURATION" \
        VUS="$K6_MATRIX_VUS" \
        PROTOCOL_MODE=http1 \
        K6_PROTOCOL=http1 \
        PROTOCOL=http1 \
        K6_HTTP2_DISABLE_REUSE="${K6_HTTP2_DISABLE_REUSE:-0}" \
        SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
        K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-}" \
        K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-}" \
        "$k6exe" run --summary-export "$sum" "$script" >>"$log" 2>&1
      rc=$?
      ;;
    http3)
      env \
        DURATION="$K6_MATRIX_DURATION" \
        VUS="$K6_MATRIX_VUS" \
        PROTOCOL_MODE=http3 \
        K6_PROTOCOL=http3 \
        PROTOCOL=http3 \
        K6_HTTP3_REQUIRE_MODULE=1 \
        K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}" \
        SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
        K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-}" \
        K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-}" \
        "$k6exe" run --summary-export "$sum" "$script" >>"$log" 2>&1
      rc=$?
      ;;
    *)
      echo "k6_matrix_exec: unknown proto $proto" >>"$log"
      rc=1
      ;;
  esac
  set -e

  {
    echo "---"
    echo "exit_code=$rc"
  } >>"$log"

  k6_matrix_handle_exit "$rc" "$log" "$sum" "$proto" "$svc" "$rel"
}

# Single cell: same binaries, env, and logging as the full matrix (compare to a manual k6 invocation).
if [[ "${1:-}" == "http1" || "${1:-}" == "http2" || "${1:-}" == "http3" ]]; then
  [[ -n "${2:-}" ]] || {
    echo "usage: $0 [http1|http2|http3] <service>   # e.g. $0 http3 gateway" >&2
    exit 1
  }
  SINGLE_PROTO="$1"
  SINGLE_SVC="$2"
  script_cell="${SERVICE_SCRIPT[$SINGLE_SVC]:-}"
  [[ -n "$script_cell" ]] || {
    echo "unknown service: $SINGLE_SVC (see SERVICE_SCRIPT keys in $0)" >&2
    exit 1
  }
  say "Single matrix cell: $SINGLE_PROTO / $SINGLE_SVC → $OUT"
  say "Inspect: $OUT/k6-matrix-logs/${SINGLE_PROTO}-${SINGLE_SVC}.log"
  if [[ "$SINGLE_PROTO" == "http3" ]]; then
    if [[ -z "$HTTP3_BIN" ]]; then
      echo "http3 requires xk6-http3 (e.g. .k6-build/bin/k6-http3). Set K6_HTTP3_BIN or run K6_MATRIX_ENSURE_HTTP3=1 $0 ..." >&2
      exit 1
    fi
    say "http3 binary (resolved): $(_och_k6_abs "$HTTP3_BIN")"
    export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
    [[ "$SINGLE_SVC" == "gateway" ]] && script_cell="$H3_SCRIPT"
    k6_matrix_exec http3 "$SINGLE_SVC" "$script_cell" "$HTTP3_BIN"
  elif [[ "$SINGLE_PROTO" == "http2" ]]; then
    say "http2 binary (resolved): $(_och_k6_abs "$K6_BIN")"
    k6_matrix_exec http2 "$SINGLE_SVC" "$script_cell" "$K6_BIN"
  else
    say "http1 binary (resolved): $(_och_k6_abs "$K6_BIN")"
    k6_matrix_exec http1 "$SINGLE_SVC" "$script_cell" "$K6_BIN"
  fi
  "$REPO_ROOT/scripts/perf/summarize-protocol-matrix.sh" "$OUT"
  say "Done (single cell). Log: $OUT/k6-matrix-logs/${SINGLE_PROTO}-${SINGLE_SVC}.log"
  exit 0
fi

say "Protocol matrix → $OUT"
say "Per-run k6 logs → $OUT/k6-matrix-logs/"
if [[ -n "$HTTP3_BIN" ]]; then
  say "Binary resolution: http1/http2 → $(_och_k6_abs "$K6_BIN") | http3 → $HTTP3_BIN (resolved: $(_och_k6_abs "$HTTP3_BIN"))"
else
  say "Binary resolution: http1/http2 → $(_och_k6_abs "$K6_BIN") | http3 → <none — skipped or missing xk6-http3>"
fi

say "1/3 ALPN/HTTP2 over core services"
for svc in "${SERVICES[@]}"; do
  script="${SERVICE_SCRIPT[$svc]:-}"
  [[ -z "$script" ]] && continue
  k6_matrix_exec http2 "$svc" "$script" "$K6_BIN"
done

say "2/3 HTTP/1.1 hint over core services (best effort)"
for svc in "${SERVICES[@]}"; do
  script="${SERVICE_SCRIPT[$svc]:-}"
  [[ -z "$script" ]] && continue
  k6_matrix_exec http1 "$svc" "$script" "$K6_BIN"
done

if [[ "${SKIP_HTTP3:-0}" == "1" ]]; then
  for svc in "${SERVICES[@]}"; do
    echo '{"skipped":true,"reason":"SKIP_HTTP3=1"}' >"$OUT/http3/${svc}-summary.json"
  done
elif [[ -n "$HTTP3_BIN" ]]; then
  say "3/3 HTTP/3 over core services (xk6-http3)"
  "$HTTP3_BIN" version 2>/dev/null | head -3 || true
  export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
  for svc in "${SERVICES[@]}"; do
    script="${SERVICE_SCRIPT[$svc]:-}"
    [[ -z "$script" ]] && continue
    if [[ "$svc" == "gateway" ]]; then
      script="$H3_SCRIPT"
    fi
    k6_matrix_exec http3 "$svc" "$script" "$HTTP3_BIN"
  done
else
  say "3/3 HTTP/3 skipped — no xk6-http3 binary"
  for svc in "${SERVICES[@]}"; do
    echo "{\"skipped\":true,\"reason\":\"missing xk6-http3 binary\"}" >"$OUT/http3/${svc}-summary.json"
  done
fi

"$REPO_ROOT/scripts/perf/summarize-protocol-matrix.sh" "$OUT"
say "Done. See $OUT/protocol-comparison.md and $OUT/k6-matrix-logs/"
