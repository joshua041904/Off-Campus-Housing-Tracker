#!/usr/bin/env bash
# Post-bootstrap: ensure Jaeger is reachable from the host (edge https://…/jaeger or MetalLB :16686 —
# no kubectl port-forward by default), run trace-contract-test + optional k6 trace validation.
#
# Env:
#   BOOTSTRAP_TRACE_GUARANTEE_AUTO_PF — default 0. Set 1 for last-resort kubectl port-forward to svc/jaeger.
#   BOOTSTRAP_TRACE_GUARANTEE_PREFER_PORT_FORWARD — default 0; set 1 to try port-forward before edge/LB discovery
#   JAEGER_ALLOW_LOOPBACK_JAEGER — default 0; set 1 to accept http://127.0.0.1:16686 when already listening
#   JAEGER_OBSERVABILITY_NS — default observability
#   JAEGER_PF_LOCAL_PORT — local bind when AUTO_PF=1 (default 16686)
#   BOOTSTRAP_TRACE_GUARANTEE_SKIP_K6 — default 0; set 1 if k6 not installed / not desired
#   BOOTSTRAP_TRACE_GUARANTEE_K6_ATTEMPTS — default 3
#   TRACE_K6_JAEGER_WAIT_SEC — sleep after k6 before validate-k6-traces (default 12)
#   E2E_API_BASE — passed through to trace-contract-test + k6 BASE_URL
#   TRACE_CONTRACT_* — see scripts/trace-contract-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT="$ROOT"
cd "$ROOT"
mkdir -p "$ROOT/bench_logs"

JAEGER_PF_PID=""
cleanup() {
  if [[ -n "${JAEGER_PF_PID:-}" ]]; then
    echo "bootstrap-trace-guarantee: stopping Jaeger port-forward (pid=$JAEGER_PF_PID)"
    kill "$JAEGER_PF_PID" 2>/dev/null || true
    wait "$JAEGER_PF_PID" 2>/dev/null || true
    JAEGER_PF_PID=""
  fi
}
trap cleanup EXIT

if [[ -f "$ROOT/scripts/lib/jaeger-resolve-query-base.sh" ]]; then
  # shellcheck source=scripts/lib/jaeger-resolve-query-base.sh
  source "$ROOT/scripts/lib/jaeger-resolve-query-base.sh"
fi

och_jaeger_traces_smoke() {
  local base="${1%/}"
  local end_ms=$(( $(date +%s) * 1000000 ))
  local start_ms=$(( end_ms - 3600 * 1000000 ))
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/och-jaeger-traces.XXXXXX")"
  if [[ "$base" == https:* ]]; then
    local ca="${NODE_EXTRA_CA_CERTS:-$ROOT/certs/dev-root.pem}"
    if [[ -f "$ca" ]]; then
      curl -sfS --max-time 15 --cacert "$ca" -G "${base}/api/traces" \
        --data-urlencode "service=api-gateway" \
        --data-urlencode "limit=1" \
        --data-urlencode "end=${end_ms}" \
        --data-urlencode "start=${start_ms}" \
        -o "$tmp" || {
        rm -f "$tmp"
        return 1
      }
    else
      rm -f "$tmp"
      return 1
    fi
  else
    curl -sfS --max-time 15 -G "${base}/api/traces" \
      --data-urlencode "service=api-gateway" \
      --data-urlencode "limit=1" \
      --data-urlencode "end=${end_ms}" \
      --data-urlencode "start=${start_ms}" \
      -o "$tmp" || {
      rm -f "$tmp"
      return 1
    }
  fi
  node -e "
    const fs = require('fs');
    const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    process.exit(Array.isArray(j.data) ? 0 : 1);
  " "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  rm -f "$tmp"
  return 0
}

echo "=== [TRACE GUARANTEE] Jaeger (host-reachable, no port-forward by default) + full-trace contract ==="

_local_pf_port="${JAEGER_PF_LOCAL_PORT:-16686}"
_local_base="http://127.0.0.1:${_local_pf_port}"
_prefer_pf="${BOOTSTRAP_TRACE_GUARANTEE_PREFER_PORT_FORWARD:-0}"
_auto_pf="${BOOTSTRAP_TRACE_GUARANTEE_AUTO_PF:-0}"
_allow_loop="${JAEGER_ALLOW_LOOPBACK_JAEGER:-0}"
_resolved=0

if [[ "$_prefer_pf" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  _ns="${JAEGER_OBSERVABILITY_NS:-observability}"
  if kubectl get svc -n "$_ns" jaeger >/dev/null 2>&1; then
    echo "TRACE GUARANTEE: PREFER_PORT_FORWARD=1 — kubectl port-forward -n $_ns svc/jaeger ${_local_pf_port}:16686"
    kubectl port-forward -n "$_ns" "svc/jaeger" "${_local_pf_port}:16686" >/dev/null 2>&1 &
    JAEGER_PF_PID=$!
    for ((_i = 1; _i <= 45; _i++)); do
      if declare -F och_jaeger_services_curl_ok >/dev/null 2>&1 && och_jaeger_services_curl_ok "$_local_base"; then
        export JAEGER_QUERY_BASE="$_local_base"
        printf '%s\n' "$JAEGER_QUERY_BASE" >"$ROOT/bench_logs/.jaeger-query-base"
        echo "TRACE GUARANTEE: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (port-forward)"
        _resolved=1
        break
      fi
      sleep 1
    done
    [[ "$_resolved" == "1" ]] || {
      echo "::error::TRACE GUARANTEE: port-forward did not become ready"
      exit 1
    }
  fi
fi

if [[ "$_resolved" != "1" ]]; then
  if [[ -f "$ROOT/bench_logs/.jaeger-query-base" ]]; then
    _jb="$(tr -d '\r\n' <"$ROOT/bench_logs/.jaeger-query-base" | sed 's/[[:space:]]*$//')"
    if [[ -n "$_jb" ]] && declare -F och_jaeger_services_curl_ok >/dev/null 2>&1 && och_jaeger_services_curl_ok "$_jb"; then
      export JAEGER_QUERY_BASE="$_jb"
      echo "TRACE GUARANTEE: JAEGER_QUERY_BASE from bench_logs/.jaeger-query-base → $JAEGER_QUERY_BASE"
      _resolved=1
    fi
  fi
fi

if [[ "$_resolved" != "1" ]] && declare -F och_jaeger_resolve_query_base >/dev/null 2>&1; then
  if och_jaeger_resolve_query_base; then
    _resolved=1
  fi
fi

if [[ "$_resolved" != "1" ]] && [[ -n "${JAEGER_QUERY_BASE:-}" ]] && declare -F och_jaeger_services_curl_ok >/dev/null 2>&1 && och_jaeger_services_curl_ok "${JAEGER_QUERY_BASE}"; then
  export JAEGER_QUERY_BASE="${JAEGER_QUERY_BASE%/}"
  echo "TRACE GUARANTEE: using pre-set JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE"
  _resolved=1
fi

if [[ "$_resolved" != "1" ]] && [[ "$_allow_loop" == "1" ]] && declare -F och_jaeger_services_curl_ok >/dev/null 2>&1 && och_jaeger_services_curl_ok "$_local_base"; then
  export JAEGER_QUERY_BASE="$_local_base"
  echo "TRACE GUARANTEE: JAEGER_ALLOW_LOOPBACK_JAEGER=1 — using $_local_base"
  _resolved=1
fi

if [[ "$_resolved" != "1" ]] && [[ "$_auto_pf" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  _ns="${JAEGER_OBSERVABILITY_NS:-observability}"
  if kubectl get svc -n "$_ns" jaeger >/dev/null 2>&1; then
    echo "TRACE GUARANTEE: BOOTSTRAP_TRACE_GUARANTEE_AUTO_PF=1 — kubectl port-forward -n $_ns svc/jaeger ${_local_pf_port}:16686"
    kubectl port-forward -n "$_ns" "svc/jaeger" "${_local_pf_port}:16686" >/dev/null 2>&1 &
    JAEGER_PF_PID=$!
    for ((_i = 1; _i <= 45; _i++)); do
      if declare -F och_jaeger_services_curl_ok >/dev/null 2>&1 && och_jaeger_services_curl_ok "$_local_base"; then
        export JAEGER_QUERY_BASE="$_local_base"
        printf '%s\n' "$JAEGER_QUERY_BASE" >"$ROOT/bench_logs/.jaeger-query-base"
        echo "TRACE GUARANTEE: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (auto port-forward)"
        _resolved=1
        break
      fi
      sleep 1
    done
  fi
fi

if [[ "$_resolved" != "1" ]] || [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  echo "::error::TRACE GUARANTEE: Jaeger Query not reachable from this host without port-forward."
  echo "  Fix: make align-hosts; export JAEGER_PUBLIC_URL=http://<metallb-jaeger-ip>:16686 OR use edge JAEGER_QUERY_BASE=https://off-campus-housing.test/jaeger"
  echo "  Optional escape: BOOTSTRAP_TRACE_GUARANTEE_AUTO_PF=1 (kubectl port-forward) or JAEGER_ALLOW_LOOPBACK_JAEGER=1"
  exit 1
fi

if ! och_jaeger_traces_smoke "${JAEGER_QUERY_BASE}"; then
  echo "::error::TRACE GUARANTEE: Jaeger /api/traces?service=api-gateway probe failed for JAEGER_QUERY_BASE=${JAEGER_QUERY_BASE}"
  exit 1
fi

export JAEGER_PUBLIC_URL="${JAEGER_PUBLIC_URL:-$JAEGER_QUERY_BASE}"
printf '%s\n' "${JAEGER_QUERY_BASE%/}" >"$ROOT/bench_logs/.jaeger-query-base"
echo "TRACE GUARANTEE: JAEGER_PUBLIC_URL=${JAEGER_PUBLIC_URL} (UI / scripts; mirrors Query base when unset)"

export TRACE_CONTRACT_REQUIRE_ALL_SERVICES="${TRACE_CONTRACT_REQUIRE_ALL_SERVICES:-1}"
export TRACE_CONTRACT_JAEGER_WAIT_SEC="${TRACE_CONTRACT_JAEGER_WAIT_SEC:-12}"
export JAEGER_QUERY_BASE

echo "▶ TRACE GUARANTEE: trace-contract-test (seed /api/debug/full-trace + validate)"
chmod +x "$ROOT/scripts/trace-contract-test.sh"
bash "$ROOT/scripts/trace-contract-test.sh"

if [[ "${BOOTSTRAP_TRACE_GUARANTEE_SKIP_K6:-0}" == "1" ]]; then
  echo "ℹ️  BOOTSTRAP_TRACE_GUARANTEE_SKIP_K6=1 — skipping k6 trace smoke"
  echo "✅ TRACE GUARANTEE PASSED (contract only)"
  exit 0
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "::error::TRACE GUARANTEE: k6 not on PATH (install k6 or set BOOTSTRAP_TRACE_GUARANTEE_SKIP_K6=1)"
  exit 1
fi

_base_url="${E2E_API_BASE:-https://off-campus-housing.test}"
_k6_log="${K6_TRACE_LOG:-$ROOT/bench_logs/k6-trace-contract.log}"
_attempts="${BOOTSTRAP_TRACE_GUARANTEE_K6_ATTEMPTS:-3}"
_wait_k6="${TRACE_K6_JAEGER_WAIT_SEC:-12}"

_last_k6=1
for ((_a = 1; _a <= _attempts; _a++)); do
  echo "▶ TRACE GUARANTEE: k6 trace smoke (attempt $_a/$_attempts) → $_k6_log"
  set +e
  BASE_URL="$_base_url" k6 run "$ROOT/scripts/load/k6-trace-contract-smoke.js" 2>&1 | tee "$_k6_log"
  _last_k6=${PIPESTATUS[0]}
  set -e
  if [[ "$_last_k6" != "0" ]]; then
    echo "TRACE GUARANTEE: k6 exit $_last_k6 (attempt $_a)"
    sleep 5
    continue
  fi
  echo "▶ TRACE GUARANTEE: waiting ${_wait_k6}s for Jaeger (k6 traces)…"
  sleep "$_wait_k6"
  set +e
  JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" bash "$ROOT/scripts/validate-k6-traces.sh" "$_k6_log"
  _v=$?
  set -e
  if [[ "$_v" == "0" ]]; then
    echo "✅ TRACE GUARANTEE PASSED (contract + k6 traces)"
    exit 0
  fi
  echo "TRACE GUARANTEE: validate-k6-traces failed (exit $_v), attempt $_a/$_attempts"
  sleep 5
done

echo "::error::TRACE GUARANTEE: k6 / k6-trace validation failed after $_attempts attempts"
exit 1
