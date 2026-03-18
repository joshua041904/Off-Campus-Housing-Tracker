#!/usr/bin/env bash
# Run k6 load phases: read, soak, sweep, limit (constant under pressure), max (absolute limit), and optionally http3 (xk6-http3).
# Multi-protocol: platform supports HTTP/1.1, HTTP/2, HTTP/3 — k6 phases cover:
#   • HTTP/2: default for standard k6 over https (ALPN); phases read, soak, sweep, limit, max use k6-reads.js / k6-limit-test-comprehensive.js
#   • HTTP/3: xk6-http3 binary (K6_HTTP3=1, K6_HTTP3_PHASES=1) — run-k6-http3-phases.sh or k6-http3-complete.js
#   • HTTP/1.1: server accepts HTTP/1.1; for explicit k6 HTTP/1.1 load use a script that forces HTTP/1.1 or run protocol comparison
# K6_PROTOCOL_COMPARISON=1 runs run-k6-protocol-comparison.sh (HTTP/2 vs HTTP/3, writes protocol-comparison.json).
# Strict TLS/mTLS: requires SSL_CERT_FILE (K6_CA_ABSOLUTE). E2E performance, load, and stress.
# Usage: SUITE_LOG_DIR=/tmp/suite K6_CA_ABSOLUTE=/path/to/ca.pem [K6_PHASES=read,soak,sweep,limit,max] [K6_HTTP3=1] [K6_HTTP3_PHASES=1] ./scripts/load/run-k6-phases.sh
# Called from run-all-test-suites.sh when RUN_K6=1 and K6_PHASES is set (e.g. RUN_FULL_LOAD=1 sets full phases).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$SCRIPT_DIR"

SUITE_LOG_DIR="${SUITE_LOG_DIR:-/tmp/k6-phases}"
K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-}"
HOST="${HOST:-off-campus-housing.local}"
PORT="${PORT:-30443}"
# BASE_URL: always use hostname for strict TLS (cert SAN has DNS:off-campus-housing.local, not IP).
# From host: use off-campus-housing.local + K6_RESOLVE so k6 connects to MetalLB IP but TLS SNI matches cert.
# Never use raw IP — causes x509 SAN mismatch (cert valid for off-campus-housing.local, not 192.168.64.240).
if [[ -n "${BASE_URL:-}" ]]; then
  # Reject raw IP (strict TLS invariant)
  if [[ "$BASE_URL" =~ ^https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:[0-9]+)? ]]; then
    echo "  ❌ Do not use raw IP for strict TLS. Use hostname (e.g. https://off-campus-housing.local:443) and K6_RESOLVE."
    exit 1
  fi
  : # use caller-provided BASE_URL
elif [[ "${K6_IN_CLUSTER:-0}" == "1" ]]; then
  BASE_URL="https://caddy-h3.ingress-nginx.svc.cluster.local:443"
  export BASE_URL
  echo "  ℹ️  k6 in-cluster: BASE_URL=$BASE_URL"
else
  # From host: use hostname + --resolve so TLS SAN matches (off-campus-housing.local in cert)
  LB_IP=""
  if [[ "${K6_USE_METALLB:-1}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
    LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  fi
  if [[ -n "$LB_IP" ]]; then
    BASE_URL="https://${HOST}:443"
    export BASE_URL
    export K6_RESOLVE="${HOST}:443:${LB_IP}"
    echo "  ℹ️  k6 from host (MetalLB): BASE_URL=$BASE_URL (ensure $HOST resolves to $LB_IP via /etc/hosts or route)"
  else
    BASE_URL="${BASE_URL:-https://${HOST}:${PORT}}"
  fi
fi
export BASE_URL
K6_DURATION="${K6_DURATION:-30s}"
K6_SOAK_DURATION="${K6_SOAK_DURATION:-120s}"
K6_VUS="${K6_VUS:-20}"
K6_RATE="${K6_RATE:-50}"
K6_PHASES="${K6_PHASES:-read}"
# Default HTTP/3 (xk6-http3) on when running multiple phases — multi-protocol (HTTP/2 + HTTP/3) without extra flags
if [[ "$K6_PHASES" == *","* ]] || [[ "$K6_PHASES" == "all" ]]; then
  K6_HTTP3="${K6_HTTP3:-1}"
  K6_HTTP3_PHASES="${K6_HTTP3_PHASES:-1}"
else
  K6_HTTP3="${K6_HTTP3:-0}"
  K6_HTTP3_PHASES="${K6_HTTP3_PHASES:-0}"
fi
K6_INSECURE="${K6_INSECURE_SKIP_TLS:-0}"

# Colima: host→VM UDP path is flaky; host k6 HTTP/3 often gets "context deadline exceeded" and 0% success. In-cluster k6 is canonical.
# Skip host HTTP/3 phase and host protocol comparison so rotation/suites don't fail on harness environment, not platform.
KUBE_CTX=$(kubectl config current-context 2>/dev/null || echo "")
SKIP_HOST_HTTP3="${SKIP_HOST_HTTP3:-0}"
[[ "$KUBE_CTX" == *"colima"* ]] && SKIP_HOST_HTTP3=1
[[ "${SKIP_HOST_HTTP3:-0}" == "1" ]] && echo "  ℹ️  SKIP_HOST_HTTP3=1 (Colima or set): host HTTP/3 test skipped; in-cluster k6 and pod capture are authoritative for QUIC."

# k6 (Go) requires a valid CA for https://off-campus-housing.local; without it we get "x509: certificate signed by unknown authority". Do not run phases without a CA.
if [[ -z "$K6_CA_ABSOLUTE" ]] || [[ ! -f "$K6_CA_ABSOLUTE" ]] || [[ ! -s "$K6_CA_ABSOLUTE" ]]; then
  echo "⚠️  Skip k6 phases: no CA (K6_CA_ABSOLUTE must point to certs/dev-root.pem). Run full preflight so rotation syncs CA to certs/dev-root.pem, or set K6_CA_ABSOLUTE=$REPO_ROOT/certs/dev-root.pem"
  exit 0
fi

mkdir -p "$SUITE_LOG_DIR"
export SSL_CERT_FILE="${K6_CA_ABSOLUTE}"
# On macOS, Go ignores SSL_CERT_FILE; k6 uses Keychain. Run trust script (same as run-k6-chaos).
if [[ "$(uname -s)" == "Darwin" ]] && [[ -n "$K6_CA_ABSOLUTE" ]] && [[ -s "$K6_CA_ABSOLUTE" ]]; then
  if [[ -f "$SCRIPT_DIR/../lib/trust-dev-root-ca-macos.sh" ]]; then
    "$SCRIPT_DIR/../lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" 2>/dev/null || true
  fi
fi
k6_extra=()
[[ "$K6_INSECURE" == "1" || "$K6_INSECURE" == "true" ]] && k6_extra+=(--insecure-skip-tls-verify) || true
# k6 has no --resolve flag (that's curl). Ensure off-campus-housing.local resolves: add to /etc/hosts or use route (e.g. Colima).
# K6_RESOLVE is for logging; pass via -e to script if needed: k6 reads BASE_URL, script may use different endpoint.

run_phase() {
  local phase="$1"
  local script="$2"
  shift 2
  local log="$SUITE_LOG_DIR/k6-${phase}.log"
  echo "  → k6 phase: $phase (log: $log)"
  if [[ -f "$script" ]]; then
    (
      export BASE_URL="$BASE_URL"
      [[ -n "${K6_RESOLVE:-}" ]] && export K6_RESOLVE="$K6_RESOLVE"
      [[ -n "$K6_CA_ABSOLUTE" ]] && [[ -s "$K6_CA_ABSOLUTE" ]] && export SSL_CERT_FILE="$K6_CA_ABSOLUTE"
      for v in "$@"; do export "$v"; done
      k6 run "${k6_extra[@]}" "$script" 2>&1 | tee "$log"
    ) || echo "  ⚠️  $phase had issues"
  else
    echo "  ⚠️  script not found: $script" >> "$log"
  fi
}

# Resolve xk6-http3 binary
K6_HTTP3_BIN=""
for candidate in "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.k6-build/k6-http3"; do
  if [[ -x "$candidate" ]]; then K6_HTTP3_BIN="$candidate"; break; fi
done

run_http3_phase() {
  local log="$SUITE_LOG_DIR/k6-http3.log"
  echo "  → k6 phase: http3 (xk6-http3; log: $log)"
  # On Darwin (Colima), host→VM QUIC often times out; noReuse avoids stale sessions, relax thresholds so run doesn't fail
  local h3_relax=""
  [[ "$(uname -s)" == "Darwin" ]] && h3_relax="K6_HTTP3_RELAX_THRESHOLDS=1"
  # K6_HTTP3_NO_REUSE=1: new QUIC connection per request from host (avoids "timeout: no recent network activity")
  export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
  if [[ -n "$K6_HTTP3_BIN" ]] && [[ -f "$LOAD_DIR/k6-http3-complete.js" ]]; then
    ( env BASE_URL="$BASE_URL" SSL_CERT_FILE="$K6_CA_ABSOLUTE" \
      K6_RESOLVE="${K6_RESOLVE:-}" K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}" HOST="$HOST" PORT="$PORT" $h3_relax \
      "$K6_HTTP3_BIN" run "${k6_extra[@]}" "$LOAD_DIR/k6-http3-complete.js" 2>&1 | tee "$log" ) || echo "  ⚠️  http3 had issues"
  else
    echo "  ⚠️  xk6-http3 not found (build with ./scripts/build-k6-http3.sh) or k6-http3-complete.js missing" >> "$log"
  fi
}

# Run requested phases (comma-separated or "all")
run_all_phases() {
  local phases
  if [[ "$K6_PHASES" == "all" ]]; then
    phases="read,soak,sweep,limit,max"
  else
    phases="$K6_PHASES"
  fi

  IFS=',' read -ra PHASE_ARR <<< "$phases"
  for p in "${PHASE_ARR[@]}"; do
    p=$(echo "$p" | tr -d ' ')
    case "$p" in
      read)
        run_phase read "$LOAD_DIR/k6-reads.js" MODE=rate RATE="$K6_RATE" DURATION="$K6_DURATION" VUS="$K6_VUS"
        ;;
      soak)
        run_phase soak "$LOAD_DIR/k6-reads.js" MODE=soak DURATION="${K6_SOAK_DURATION}" VUS="$K6_VUS"
        ;;
      sweep)
        run_phase sweep "$LOAD_DIR/k6-reads.js" MODE=sweep RATE_START=25 RATE_STEP=25 STEPS=5 STEP_DUR=30s
        ;;
      limit)
        run_phase limit "$LOAD_DIR/k6-limit-test-comprehensive.js" MODE=persistence DURATION=300s
        ;;
      max)
        run_phase max "$LOAD_DIR/k6-limit-test-comprehensive.js" MODE=limit DURATION=180s
        ;;
      messaging)
        run_phase messaging "$LOAD_DIR/k6-messaging.js" DURATION="${K6_DURATION}" RATE="${K6_RATE:-20}" VUS="${K6_VUS:-10}"
        ;;
      *)
        echo "  ⚠️  unknown phase: $p (skip)"
        ;;
    esac
  done

  if [[ "${K6_HTTP3:-0}" == "1" ]] && [[ "${SKIP_HOST_HTTP3:-0}" != "1" ]]; then
    if [[ "${K6_HTTP3_PHASES:-0}" == "1" ]] && [[ -f "$LOAD_DIR/run-k6-http3-phases.sh" ]]; then
      ( export SUITE_LOG_DIR BASE_URL K6_CA_ABSOLUTE K6_DURATION K6_SOAK_DURATION K6_INSECURE_SKIP_TLS HOST PORT K6_RESOLVE
        "$LOAD_DIR/run-k6-http3-phases.sh" ) || echo "  ⚠️  xk6 HTTP/3 phases had issues"
    else
      run_http3_phase
    fi
  elif [[ "${K6_HTTP3:-0}" == "1" ]] && [[ "${SKIP_HOST_HTTP3:-0}" == "1" ]]; then
    echo "  ℹ️  Host HTTP/3 phase skipped (SKIP_HOST_HTTP3=1); in-cluster k6 and rotation chaos are canonical for QUIC."
  fi

  # Optional: HTTP/2 vs HTTP/3 protocol comparison (host); skip on Colima — host UDP path unreliable.
  if [[ "${K6_PROTOCOL_COMPARISON:-0}" == "1" ]] && [[ "${SKIP_HOST_HTTP3:-0}" != "1" ]] && [[ -f "$LOAD_DIR/run-k6-protocol-comparison.sh" ]]; then
    ( export SUITE_LOG_DIR BASE_URL K6_CA_ABSOLUTE K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
      "$LOAD_DIR/run-k6-protocol-comparison.sh" ) || echo "  ⚠️  Protocol comparison had issues"
  elif [[ "${K6_PROTOCOL_COMPARISON:-0}" == "1" ]] && [[ "${SKIP_HOST_HTTP3:-0}" == "1" ]]; then
    echo "  ℹ️  Protocol comparison (host) skipped on Colima; in-cluster k6 is authoritative."
  fi
  # Optional: find max RPS with zero errors per protocol (stop when tested protocol errors; 5-chart report)
  if [[ "${K6_MAX_RPS_NO_ERRORS:-0}" == "1" ]] && [[ -f "$LOAD_DIR/run-k6-max-rps-no-errors.sh" ]]; then
    ( export SUITE_LOG_DIR BASE_URL K6_CA_ABSOLUTE RPS_STEP RPS_MAX STEP_DURATION
      "$LOAD_DIR/run-k6-max-rps-no-errors.sh" ) || echo "  ⚠️  Max RPS (no errors) suite had issues"
  fi
}

# Single k6-load.log for backward compat: last phase or read phase
run_all_phases

# Optional: HTTP/2 vs HTTP/3 protocol comparison (host); skipped when SKIP_HOST_HTTP3=1 (Colima).
if [[ "${K6_PROTOCOL_COMPARISON:-0}" == "1" ]] && [[ "${SKIP_HOST_HTTP3:-0}" != "1" ]] && [[ -f "$LOAD_DIR/run-k6-protocol-comparison.sh" ]]; then
  ( export SUITE_LOG_DIR BASE_URL K6_CA_ABSOLUTE K6_INSECURE_SKIP_TLS K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
    "$LOAD_DIR/run-k6-protocol-comparison.sh" ) || true
fi
# Optional: max RPS with no errors (HTTP/2 and HTTP/3; stop when protocol under test errors; 5 charts)
if [[ "${K6_MAX_RPS_NO_ERRORS:-0}" == "1" ]] && [[ -f "$LOAD_DIR/run-k6-max-rps-no-errors.sh" ]]; then
  ( export SUITE_LOG_DIR BASE_URL K6_CA_ABSOLUTE K6_INSECURE_SKIP_TLS
    "$LOAD_DIR/run-k6-max-rps-no-errors.sh" ) || true
fi

if [[ -f "$SUITE_LOG_DIR/k6-read.log" ]]; then
  cp -f "$SUITE_LOG_DIR/k6-read.log" "$SUITE_LOG_DIR/k6-load.log" 2>/dev/null || true
fi
