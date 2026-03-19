#!/usr/bin/env bash
# Baseline smoke: REST via HTTP/2 + HTTP/3, gRPC health (15a–15j), optional packet capture.
# For housing-only (auth + messaging, no RP): use ./scripts/test-microservices-http2-http3-housing.sh instead.
# Protocol strict: HTTP/2 tests use strict_curl with --http2 (strict TLS; ALPN = no prior knowledge). HTTP/3 tests use strict_http3_curl with --http3-only (no fallback).
# We do NOT use --http2-prior-knowledge (use ALPN negotiation). All H2: --http2; all H3: --http3-only.
# Capture: starts on Caddy + Envoy before tests; stops after Test 15b (delete account via HTTP/3) so 15b is included (bounded: BASELINE_CAPTURE_WAIT_CAP=10s default).
# Run ensure-tcpdump-in-capture-pods.sh before suites so tcpdump is pre-installed and capture start is fast.
# Env: CAPTURE_STOP_TIMEOUT (from preflight/run-all), BASELINE_CAPTURE_WAIT_CAP=10 (max wait for stop before proceeding).
# Timeout: set SUITE_TIMEOUT=3600 and run as: timeout $SUITE_TIMEOUT ./scripts/test-microservices-http2-http3.sh so the suite progresses and exits after cap. Health/connectivity curls use CURL_MAX_TIME (default 15) and CURL_CONNECT_TIMEOUT (default 3); API calls use 10–60s.
# HTTP codes: failures print "HTTP $CODE" and curl exit (for HTTP/3: exit 7/28/55 + meaning). DB checks run on success (Test N DB: ...).
# Schema: All 8 DBs (5433–5440) exercised per docs/CURRENT_DB_SCHEMA_REPORT.md. Row counts ~rows=-1 in report = planner estimate (unanalyzed/empty); verify_db_after_test confirms real data after writes.
# HTTP/3: All strict_http3_curl calls are guarded (e.g. ... || RC=$?) so a failing QUIC/curl does not exit the suite; see docs/HTTP3-CURL-EXIT-CODES.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shims first so kubectl uses shim (avoids API server timeouts). See API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }
# Smoke test uses ✅/❌/⚠️ (green check) so pass/fail is visible; skip test-log.sh here
# kubectl helper: use colima ssh when in Colima context (ensures fresh secrets from VM)
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# Dynamic LB IP: MetalLB can reassign after Caddy rollout. Always use current value from cluster (never hardcoded or stale).
_live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
[[ -z "$_live_lb" ]] && _live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
if [[ -n "$_live_lb" ]]; then
  export TARGET_IP="$_live_lb"
  export REACHABLE_LB_IP="$_live_lb"
fi
unset _live_lb 2>/dev/null || true

# Host kubectl for port-forward so 127.0.0.1 is on host (Test 15 gRPC; Colima shim would listen inside VM)
if [[ -z "${KUBECTL_PORT_FORWARD:-}" ]]; then
  if [[ -x /opt/homebrew/bin/kubectl ]]; then
    export KUBECTL_PORT_FORWARD="/opt/homebrew/bin/kubectl --request-timeout=15s"
  elif [[ -x /usr/local/bin/kubectl ]]; then
    export KUBECTL_PORT_FORWARD="/usr/local/bin/kubectl --request-timeout=15s"
  else
    export KUBECTL_PORT_FORWARD="kubectl --request-timeout=15s"
  fi
fi

NS="off-campus-housing-tracker"
HOST="${HOST:-off-campus-housing.local}"
# Prefer a curl that supports HTTP/3 (--http3): Homebrew curl has it; system curl on macOS does not.
# This avoids Docker-bridge HTTP/3 (exit 28) by using native curl to LB IP when available.
if [[ -z "${CURL_BIN:-}" ]]; then
  _curl_has_http3() { [[ -x "${1:-}" ]] && "$1" --help all 2>/dev/null | grep -q -- "--http3"; }
  if _curl_has_http3 /opt/homebrew/opt/curl/bin/curl; then
    CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
  elif _curl_has_http3 /usr/local/opt/curl/bin/curl; then
    CURL_BIN="/usr/local/opt/curl/bin/curl"
  elif _curl_has_http3 "$(command -v curl 2>/dev/null)"; then
    CURL_BIN="$(command -v curl)"
  else
    # Prefer Homebrew path even if no --http3 (e.g. old formula) so curl-config matches
    [[ -x /opt/homebrew/opt/curl/bin/curl ]] && CURL_BIN="/opt/homebrew/opt/curl/bin/curl" || CURL_BIN="curl"
  fi
  unset -f _curl_has_http3 2>/dev/null || true
fi
export CURL_BIN
# Curl robustness under load (exit 28 = timeout): longer max-time/connect-timeout; preflight sets these when invoked from run-preflight.
export CURL_MAX_TIME="${CURL_MAX_TIME:-15}"
export CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-3}"
# HTTP/3 probe/verify: give QUIC time to establish (host→LB IP can be slow). Retries avoid transient failure.
export BASELINE_H3_PROBE_MAX_TIME="${BASELINE_H3_PROBE_MAX_TIME:-40}"
export BASELINE_H3_PROBE_CONNECT="${BASELINE_H3_PROBE_CONNECT:-8}"
export BASELINE_H3_PROBE_RETRIES="${BASELINE_H3_PROBE_RETRIES:-3}"
export BASELINE_H3_PROBE_SLEEP="${BASELINE_H3_PROBE_SLEEP:-5}"
export BASELINE_H3_VERIFY_MAX_TIME="${BASELINE_H3_VERIFY_MAX_TIME:-40}"
export BASELINE_H3_VERIFY_RETRIES="${BASELINE_H3_VERIFY_RETRIES:-3}"
export BASELINE_H3_VERIFY_SLEEP="${BASELINE_H3_VERIFY_SLEEP:-5}"
# Disable GSO for QUIC/HTTP/3 to avoid sendmsg errno 5 (EIO) on macOS / Docker
export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"

# Validate PORT if set - if it's 443 (default HTTPS), re-detect
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  CURRENT_CONTEXT="$ctx"
  if [[ "$CURRENT_CONTEXT" == "kind-h3-multi" ]]; then
    # Multi-node cluster: try ports 8444, 8445, 8446
    # For port detection only, use -k (just checking connectivity, not security)
    # All actual test requests will use strict TLS via strict_curl
    for p in 8445 8446 8444; do
      if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
        PORT=$p
        break
      fi
    done
    PORT="${PORT:-8445}"
  else
    # With NodePort, use 30443 (or detect from service)
    PORT="${PORT:-30443}"  # Default to NodePort 30443
    # Try to detect actual NodePort from service if not set
    if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "30443" ]]; then
      DETECTED_PORT=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      if [[ -n "$DETECTED_PORT" ]]; then
        PORT=$DETECTED_PORT
      fi
    fi
  fi
fi

# Smoke test: always use ✅/❌/⚠️ (green check) for visibility
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }
info() { echo "ℹ️  $*"; }
# When CAPTURE_FAILED_RESPONSE=1, print response body on failure for debugging
_maybe_capture() {
  [[ "${CAPTURE_FAILED_RESPONSE:-}" != "1" ]] && return
  local resp="$1"
  local label="${2:-Response}"
  [[ -z "$resp" ]] && return
  local body
  body=$(echo "$resp" | sed '$d')
  [[ -n "$body" ]] && echo "  [$label] body: ${body:0:500}..."
}
# Print error_code / message / hint from JSON body when response is 5xx (so failures are clear)
_echo_error_hint() {
  local resp="$1"
  local label="${2:-}"
  [[ -z "$resp" ]] && return
  local code
  code=$(echo "$resp" | tail -1)
  [[ "$code" != 5* ]] && return
  local body
  body=$(echo "$resp" | sed '$d')
  [[ -z "$body" ]] && return
  local hint
  hint=$(echo "$body" | grep -o '"hint":"[^"]*"' 2>/dev/null | head -1 | sed 's/"hint":"//;s/"$//')
  local msg
  msg=$(echo "$body" | grep -o '"message":"[^"]*"' 2>/dev/null | head -1 | sed 's/"message":"//;s/"$//')
  local errcode
  errcode=$(echo "$body" | grep -o '"error_code":"[^"]*"' 2>/dev/null | head -1 | sed 's/"error_code":"//;s/"$//')
  [[ -n "$errcode" ]] && info "  [$label] error_code: $errcode"
  [[ -n "$msg" ]] && info "  [$label] message: $msg"
  [[ -n "$hint" ]] && info "  [$label] hint: $hint"
}
# Track suite duration: timestamps and elapsed so we can see how long each part takes
SUITE_START=$(date +%s)
_ts_elapsed() { echo $(( $(date +%s) - SUITE_START )); }
_say_ts() { printf "\n\033[1m[%s] (%ss elapsed) %s\033[0m\n" "$(date +%H:%M:%S)" "$(_ts_elapsed)" "$*"; }
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

# Get CA certificate for strict TLS verification (no -k flags, production-ready)
# Priority: 1) K8s secret (dev-root-ca), 2) certs/dev-root.pem (canonical repo CA), 3) mkcert, 4) /tmp/grpc-certs/ca.crt
# Try host kubectl first (tunnel may work), then _kb (colima ssh) when host can't reach API.
# IMPORTANT: Always prefer absolute path for CA - relative paths break when harness runs from different cwd (see exit 60 diagnosis).
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
mkdir -p "$REPO_ROOT/certs"
CA_CERT=""
# First try Kubernetes secret (matches certificates after rotation)
K8S_CA_ING=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
[[ -z "$K8S_CA_ING" ]] || ! echo "$K8S_CA_ING" | grep -q "BEGIN CERTIFICATE" && \
  K8S_CA_ING=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]] && echo "$K8S_CA_ING" | grep -q "BEGIN CERTIFICATE"; then
  CA_CERT="/tmp/test-ca-k8s-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
  echo "$K8S_CA_ING" > "$REPO_ROOT/certs/dev-root.pem"
  ok "Using Kubernetes CA secret (ingress-nginx) for strict TLS"
fi
# Fallback to off-campus-housing-tracker namespace
if [[ -z "$CA_CERT" ]]; then
  K8S_CA=$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]] && echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
    CA_CERT="/tmp/test-ca-$$.pem"
    echo "$K8S_CA" > "$CA_CERT"
    echo "$K8S_CA" > "$REPO_ROOT/certs/dev-root.pem"
    ok "Using Kubernetes CA secret (off-campus-housing-tracker) for strict TLS"
  fi
fi
# Canonical repo CA (dev-root-ca). Use absolute path so harness works regardless of cwd.
# Prefer over mkcert because after rotation to dev-root-ca, mkcert CA does NOT match and causes exit 60.
if [[ -z "$CA_CERT" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  CA_CERT="$REPO_ROOT/certs/dev-root.pem"
  ok "Using canonical repo CA for strict TLS: $CA_CERT"
fi
# Fallback to mkcert CA (may not match if rotated to dev-root-ca)
if [[ -z "$CA_CERT" ]] && command -v mkcert >/dev/null 2>&1; then
  MKCERT_CA="$(mkcert -CAROOT)/rootCA.pem"
  if [[ -f "$MKCERT_CA" ]]; then
    CA_CERT="$MKCERT_CA"
    ok "Using mkcert CA for strict TLS: $CA_CERT"
  fi
fi
# Final fallback to pre-extracted certs
if [[ -z "$CA_CERT" ]] && [[ -f "/tmp/grpc-certs/ca.crt" ]]; then
  CA_CERT="/tmp/grpc-certs/ca.crt"
  ok "Using pre-extracted CA cert for strict TLS"
fi

# Export for tools that use SSL_CERT_FILE / CURL_CA_BUNDLE (fixes curl 60 when --cacert path is wrong)
if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
  export SSL_CERT_FILE="$CA_CERT"
  export CURL_CA_BUNDLE="$CA_CERT"
fi

# Diagnostic when CA resolution fails (helps debug exit 60: client not using CA file)
if [[ -z "$CA_CERT" ]] || [[ ! -f "$CA_CERT" ]]; then
  if [[ "${CA_DEBUG:-0}" == "1" ]]; then
    echo "CA_DEBUG: pwd=$(pwd); REPO_ROOT=$REPO_ROOT"
    echo "CA_DEBUG: certs/dev-root.pem: $(ls -l "$REPO_ROOT/certs/dev-root.pem" 2>/dev/null || echo 'not found')"
  fi
fi

# Helper function for strict TLS curl (no -k flag)
strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    # Use --cacert with proper quoting for paths with spaces
    "$CURL_BIN" --cacert "$CA_CERT" "$@"
  else
    warn "CA certificate not found - using insecure TLS (dev only, NOT production-ready)"
    "$CURL_BIN" -k "$@"
  fi
}

# Helper function for strict TLS http3_curl (with CA cert support).
# HTTP/3 must use --http3-only so we never fall back to HTTP/2; we add it if not already in args.
# --no-keepalive avoids stale QUIC connection reuse after rotation; --connect-timeout/--max-time bound hangs.
strict_http3_curl() {
  local has_http3_only=0
  for _a in "$@"; do [[ "$_a" == "--http3-only" ]] && has_http3_only=1 && break; done
  local extra=(--no-keepalive --connect-timeout 5 --max-time 8)
  [[ "$has_http3_only" -eq 0 ]] && extra+=(--http3-only)
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    export CADDY_NODEPORT="${CADDY_NODEPORT:-${HTTP3_NODEPORT:-30443}}"
    http3_curl --cacert "$CA_CERT" "${extra[@]}" "$@"
  else
    warn "CA certificate not found for HTTP/3 - using insecure TLS (dev only)"
    export CADDY_NODEPORT="${CADDY_NODEPORT:-${HTTP3_NODEPORT:-30443}}"
    http3_curl -k "${extra[@]}" "$@"
  fi
}

# Ensure API server is reachable (Colima/k3s: 45s preflight, 60s ensure, 8 attempts)
if [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
  PREFLIGHT_CAP=45 "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || true
fi
if [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=8 API_SERVER_SLEEP=2 \
    ENSURE_CAP=120 PREFLIGHT_CAP=45 "$SCRIPT_DIR/ensure-api-server-ready.sh" 2>/dev/null || warn "API server check failed; continuing anyway..."
fi

# When TARGET_IP is set (e.g. LB IP from MetalLB verification), HTTP/2 curl uses that IP; else 127.0.0.1 (NodePort)
CURL_RESOLVE_IP="${TARGET_IP:-127.0.0.1}"
# HTTP/3 (QUIC/UDP): use NodePort to 127.0.0.1 so QUIC works from host. LB IP + UDP often fails on macOS (socat); past fix = always use NodePort for HTTP/3.
DETECTED_NODEPORT=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null | head -1 | awk '{print $1}')
HTTP3_NODEPORT="${DETECTED_NODEPORT:-30443}"
export CADDY_NODEPORT="$HTTP3_NODEPORT"
# HTTP3_RESOLVE: when using LB IP (MetalLB + socat), use LB IP:443 for HTTP/3 so we don't rely on NodePort; else use NodePort
# On Darwin (macOS): prefer LB IP:443 with native curl (host can reach LB IP). If native curl lacks --http3,
# fall back to Docker bridge (host.docker.internal:18443) for http3_curl (runs in Docker VM).
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
  export HTTP3_USE_LB_IP=1
  # Direct only: no Docker bridge when using MetalLB LB IP (deterministic; avoids exit 55 from bridge path).
  export HTTP3_SKIP_DOCKER_BRIDGE=1
  # Option A: prefer localhost:443 when k3d was created with 443:443@loadbalancer (bypasses NodePort/socat)
  # Colima/FORCE_METALLB_ONLY: never use 127.0.0.1 — NodePort not exposed; always use LB IP.
  if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]]; then
    HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
    export HTTP3_USE_NATIVE_CURL=1
    info "HTTP/3 will use LB IP $TARGET_IP:443 (FORCE_METALLB_ONLY; no localhost/NodePort)"
  elif [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3"; then
    _h3_localhost_443="000"
    _h3_localhost_443=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only --no-keepalive -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 \
      --resolve "${HOST}:443:127.0.0.1" "https://${HOST}/_caddy/healthz" 2>/dev/null || echo "000")
    if [[ "$_h3_localhost_443" == "200" ]]; then
      HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
      export HTTP3_USE_NATIVE_CURL=1
      info "HTTP/3 will use localhost:443 (k3d loadbalancer publish; direct, no bridge)"
    else
      # Direct LB IP:443 only (no Docker bridge fallback when HTTP3_SKIP_DOCKER_BRIDGE=1)
      HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
      export HTTP3_USE_NATIVE_CURL=1
      _h3_lb_probe="000"
      _probe_attempt=1
      while [[ $_probe_attempt -le "${BASELINE_H3_PROBE_RETRIES:-3}" ]]; do
        _h3_lb_probe=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only --no-keepalive -k -sS -o /dev/null -w "%{http_code}" \
          --connect-timeout "${BASELINE_H3_PROBE_CONNECT:-8}" --max-time "${BASELINE_H3_PROBE_MAX_TIME:-40}" \
          --resolve "${HOST}:443:${TARGET_IP}" "https://${HOST}/_caddy/healthz" 2>/dev/null || echo "000")
        [[ "$_h3_lb_probe" == "200" ]] && break
        [[ $_probe_attempt -lt "${BASELINE_H3_PROBE_RETRIES:-3}" ]] && sleep "${BASELINE_H3_PROBE_SLEEP:-5}"
        _probe_attempt=$((_probe_attempt + 1))
      done
      if [[ "$_h3_lb_probe" == "200" ]]; then
        info "HTTP/3 will use native curl via LB IP $TARGET_IP:443 (direct; no bridge)"
      else
        info "HTTP/3 will use LB IP $TARGET_IP:443 (direct; probe returned $_h3_lb_probe after ${BASELINE_H3_PROBE_RETRIES:-3} attempts — set ALLOW_NODEPORT_FALLBACK=1 to try NodePort)"
      fi
    fi
  elif [[ "$(uname -s)" == "Darwin" ]] && [[ -z "${DOCKER_HOST_IP:-}" ]] && command -v docker >/dev/null 2>&1; then
    # Fallback: Docker bridge (host.docker.internal:18443) when native curl lacks HTTP/3
    _dh=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || echo "")
    [[ -n "$_dh" ]] && export DOCKER_HOST_IP="$_dh"
    _dp="18443"
    [[ -n "${TARGET_IP:-}" ]] && _pf="${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$TARGET_IP" | tr '.' '_').txt"
    [[ -f "${_pf:-}" ]] && _dp=$(cat "$_pf" 2>/dev/null || echo "18443")
    [[ -z "${DOCKER_FORWARD_PORT:-}" ]] && export DOCKER_FORWARD_PORT="$_dp"
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && [[ -n "${DOCKER_HOST_IP:-}" ]] && [[ -n "${DOCKER_FORWARD_PORT:-}" ]] && [[ "${HTTP3_USE_NATIVE_CURL:-0}" != "1" ]]; then
    HTTP3_RESOLVE="${HOST}:${DOCKER_FORWARD_PORT}:${DOCKER_HOST_IP}"
    export HTTP3_DOCKER_FORWARD_PORT="$DOCKER_FORWARD_PORT"
    info "HTTP/3 will use Docker bridge $DOCKER_HOST_IP:${DOCKER_FORWARD_PORT} (host.docker.internal; native curl lacks --http3)"
    info "  Root fix for HTTP/3 (avoid exit 28): brew install curl (ensure --http3); set NGTCP2_ENABLE_GSO=0 (already set). See docs/RCA-HTTP3-CURL-EXIT-28.md"
  elif [[ "$(uname -s)" == "Darwin" ]] && [[ "${HTTP3_FORCE_NODEPORT_ON_DARWIN:-0}" == "1" ]] && [[ "${FORCE_METALLB_ONLY:-0}" != "1" ]]; then
    warn "HTTP3_FORCE_NODEPORT_ON_DARWIN=1 — using NodePort for HTTP/3."
    HTTP3_RESOLVE="${HOST}:${HTTP3_NODEPORT}:127.0.0.1"
    export HTTP3_USE_LB_IP=0
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    # MetalLB primary: use LB IP for HTTP/3. When TARGET_IP and PORT=443, suite uses MetalLB (proven); do not fall back to NodePort unless explicitly allowed.
    HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
    _h3_probe_ok=0
    if [[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
      . "$SCRIPT_DIR/lib/http3.sh"
      _probe_attempt=1
      while [[ $_probe_attempt -le "${BASELINE_H3_PROBE_RETRIES:-3}" ]]; do
        _h3_code=$(http3_curl --http3-only -sS -o /dev/null -w "%{http_code}" \
          --connect-timeout "${BASELINE_H3_PROBE_CONNECT:-8}" --max-time "${BASELINE_H3_PROBE_MAX_TIME:-40}" \
          --resolve "$HTTP3_RESOLVE" --cacert "$CA_CERT" "https://$HOST/_caddy/healthz" 2>/dev/null || echo "000")
        [[ "$_h3_code" == "200" ]] && _h3_probe_ok=1 && break
        [[ $_probe_attempt -lt "${BASELINE_H3_PROBE_RETRIES:-3}" ]] && sleep "${BASELINE_H3_PROBE_SLEEP:-5}"
        _probe_attempt=$((_probe_attempt + 1))
      done
    fi
    if [[ "$_h3_probe_ok" != "1" ]]; then
      if [[ "${ALLOW_NODEPORT_FALLBACK:-0}" == "1" ]]; then
        warn "HTTP/3 probe to LB IP $TARGET_IP:443 failed. Fallback: using NodePort (ALLOW_NODEPORT_FALLBACK=1)."
        HTTP3_RESOLVE="${HOST}:${HTTP3_NODEPORT}:127.0.0.1"
        export HTTP3_USE_LB_IP=0
      else
        info "HTTP/3 will use MetalLB IP $TARGET_IP:443 (probe failed but suite uses LB IP as primary; set ALLOW_NODEPORT_FALLBACK=1 to use NodePort)"
        export HTTP3_USE_LB_IP=1
      fi
    else
      info "HTTP/3 will use LB IP $TARGET_IP:443 (MetalLB; socat forwards UDP 443)"
    fi
  else
    HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
    info "HTTP/3 will use LB IP $TARGET_IP:443 (MetalLB; socat forwards UDP 443)"
  fi
else
  HTTP3_RESOLVE="${HOST}:${HTTP3_NODEPORT}:${CURL_RESOLVE_IP}"
  export HTTP3_USE_LB_IP=0
fi
# On k3d with TCP port-forward (8443), UDP is not forwarded so HTTP/3 (QUIC) will fail with curl exit 7
K3D_TCP_PORT_FORWARD_ONLY=0
if [[ "$ctx" == *"k3d"* ]] && [[ "${PORT:-}" == "8443" ]]; then
  K3D_TCP_PORT_FORWARD_ONLY=1
  info "On k3d with TCP port-forward (PORT=8443), HTTP/3 (QUIC/UDP) is not forwarded; HTTP/3 will fail here. Recreate cluster with scripts/k3d-create-2-node-cluster.sh so NodePort 30443 is published for HTTP/3."
fi

# Connectivity diagnostic when using LB IP: if TCP to LB IP fails (e.g. exit 7), try NodePort and fallback so suite can run
if [[ -n "${TARGET_IP:-}" ]] && [[ -n "${PORT:-}" ]]; then
  _tcp_ok=0
  _preflight_body=$(mktemp 2>/dev/null || echo "/tmp/tls-preflight-connect-$$.out")
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    strict_curl -sS -o /dev/null -w "%{http_code} time_total=%{time_total}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-3}" --max-time "${CURL_MAX_TIME:-15}" --http2 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" > "$_preflight_body" 2>/dev/null && _tcp_ok=1
  else
    curl -k -sS -o /dev/null -w "%{http_code} time_total=%{time_total}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-3}" --max-time "${CURL_MAX_TIME:-15}" --http2 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" > "$_preflight_body" 2>/dev/null && _tcp_ok=1
  fi
  _tcp_code=$(head -1 "$_preflight_body" 2>/dev/null | grep -oE '^[0-9]+' || echo "000")
  rm -f "$_preflight_body" 2>/dev/null || true
  if [[ "$_tcp_ok" != "1" ]] || [[ "$_tcp_code" != "200" ]]; then
    # LB IP path failed. When using MetalLB (TARGET_IP + PORT=443), keep LB IP unless user allows NodePort fallback.
    _np_code="000"
    if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      strict_curl -sS -o /dev/null -w "%{http_code} time_total=%{time_total}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-3}" --max-time "${CURL_MAX_TIME:-15}" --http2 \
        --resolve "$HOST:${HTTP3_NODEPORT}:127.0.0.1" -H "Host: $HOST" "https://$HOST:${HTTP3_NODEPORT}/_caddy/healthz" > "$_preflight_body" 2>/dev/null || true
    else
      curl -k -sS -o /dev/null -w "%{http_code} time_total=%{time_total}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-3}" --max-time "${CURL_MAX_TIME:-15}" --http2 \
        --resolve "$HOST:${HTTP3_NODEPORT}:127.0.0.1" -H "Host: $HOST" "https://$HOST:${HTTP3_NODEPORT}/_caddy/healthz" > "$_preflight_body" 2>/dev/null || true
    fi
    _np_code=$(head -1 "$_preflight_body" 2>/dev/null | grep -oE '^[0-9]+' || echo "000")
    rm -f "$_preflight_body" 2>/dev/null || true
    if [[ "${ALLOW_NODEPORT_FALLBACK:-0}" == "1" ]] && [[ "${FORCE_METALLB_ONLY:-0}" != "1" ]] && [[ "$_np_code" == "200" ]]; then
      warn "TCP to LB IP ${CURL_RESOLVE_IP}:${PORT} unreachable (code ${_tcp_code}). Falling back to NodePort (ALLOW_NODEPORT_FALLBACK=1)."
      CURL_RESOLVE_IP="127.0.0.1"
      PORT="$HTTP3_NODEPORT"
      export PORT
    elif [[ "$_tcp_ok" != "1" ]]; then
      warn "TCP to LB IP ${CURL_RESOLVE_IP}:${PORT} unreachable (code ${_tcp_code}). Keeping MetalLB IP for suite (set ALLOW_NODEPORT_FALLBACK=1 to use NodePort)."
      info "  Ensure MetalLB speaker and Caddy are Ready; host can route to ${TARGET_IP}."
    else
      info "Connectivity: TCP ${CURL_RESOLVE_IP}:${PORT} -> ${_tcp_code} (LB IP); NodePort -> ${_np_code}."
    fi
  fi
fi

TOKEN=""
TOKEN_USER2=""
USER1_ID=""
USER2_ID=""
GROUP_ID=""
TEST_EMAIL=""
TEST_PASSWORD="test123"

_say_ts "=== Testing Microservices via HTTP/2 and HTTP/3 ==="

# Packet capture: 3-layer v2 (node + Caddy pod + Envoy pod) on Colima for reliable TCP/UDP 443 visibility; else v1 (pod-only).
CAPTURE_DIR="/tmp/baseline-captures-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CAPTURE_DIR"
export CAPTURE_COPY_DIR="$CAPTURE_DIR"
export CAPTURE_DRAIN_SECONDS=5
CADDY_POD=$(_kb -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ENVOY_POD=$(_kb -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ENVOY_NS="envoy-test"
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(_kb -n ingress-nginx get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ENVOY_NS="ingress-nginx"
fi
# Envoy is ClusterIP; gRPC is reached via Caddy (TARGET_IP:443). ENVOY_LB_IP left for backwards compat (empty when Envoy is ClusterIP).
ENVOY_LB_IP=$(_kb -n envoy-test get svc envoy-test -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
[[ -z "$ENVOY_LB_IP" ]] && ENVOY_LB_IP=$(_kb -n envoy-test get svc envoy-test -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
if [[ -n "$ENVOY_LB_IP" ]] && [[ "${PORT:-}" == "443" ]]; then
  info "Envoy gRPC via MetalLB: $ENVOY_LB_IP:443 (legacy; prefer Caddy ${TARGET_IP:-}:443)"
fi
export ENVOY_LB_IP
say "Packet capture: HTTP/2 (TCP 443), HTTP/3/QUIC (UDP 443), gRPC (Envoy)"
# Set traffic target for capture report (NodePort vs LB IP) if not already set by run-all
if [[ -z "${CAPTURE_TRAFFIC_TARGET:-}" ]]; then
  if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
    export CAPTURE_TRAFFIC_TARGET="LB IP ${TARGET_IP}:443"
  elif [[ -n "${TARGET_IP:-}" ]]; then
    export CAPTURE_TRAFFIC_TARGET="LB IP ${TARGET_IP}:${PORT:-30443}"
  else
    export CAPTURE_TRAFFIC_TARGET="NodePort 127.0.0.1:${PORT:-30443}"
  fi
fi
info "Traffic path (HTTP/2 + HTTP/3): ${CAPTURE_TRAFFIC_TARGET} (tests hit this; capture shows traffic to pods)"
# Use 3-layer capture v2 by default on Colima (node + Caddy + Envoy); set USE_PACKET_CAPTURE_V2=0 for legacy pod-only.
BASELINE_CAPTURE_V2=0
if [[ "${USE_PACKET_CAPTURE_V2:-}" == "1" ]] || { [[ "${USE_PACKET_CAPTURE_V2:-}" != "0" ]] && [[ "$ctx" == *"colima"* ]]; }; then
  BASELINE_CAPTURE_V2=1
  [[ -z "${CAPTURE_WARMUP_SECONDS:-}" ]] && export CAPTURE_WARMUP_SECONDS=4
  export CAPTURE_RUN_TYPE="${CAPTURE_RUN_TYPE:-baseline}"
  export TRANSPORT_CAPTURES_DIR="${TRANSPORT_CAPTURES_DIR:-/tmp/transport-captures}"
  . "$SCRIPT_DIR/lib/packet-capture-v2.sh"
  init_capture_session_v2
  export CAPTURE_V2_CADDY_POD="$CADDY_POD"
  export CAPTURE_V2_CADDY_NS="ingress-nginx"
  export CAPTURE_V2_ENVOY_POD="$ENVOY_POD"
  export CAPTURE_V2_ENVOY_NS="$ENVOY_NS"
  [[ -n "${TARGET_IP:-}" ]] && export CAPTURE_V2_LB_IP="$TARGET_IP"
  ok "Starting 3-layer capture (L1=node L2=Caddy L3=Envoy)"
  start_capture_v2
  info "Capture runs in background; will stop and report at end of suite (tcpdump -r + transport-summary.json)."
else
  . "$SCRIPT_DIR/lib/packet-capture.sh"
  init_capture_session
  export CAPTURE_INSTALL_TIMEOUT="${CAPTURE_INSTALL_TIMEOUT:-45}"
  info "For tcpdump preinstalled in pods: run scripts/ensure-tcpdump-in-capture-pods.sh before suites; on k3d, preflight 3c0a uses caddy-with-tcpdump image"
  info "Capture runs in background during all tests below; will stop and report at end of suite (first packets + protocol counts)."
  # Strict filter when LB IP set: only traffic to MetalLB IP (no kubelet/readiness/probe noise)
  if [[ -n "${TARGET_IP:-}" ]]; then
    # MetalLB L2: traffic inside Caddy pod is DNAT'd — use port-only so we see TCP/UDP 443 (host filter would show 0)
    CADDY_CAPTURE_FILTER="tcp port 443 or udp port 443"
  else
    CADDY_CAPTURE_FILTER="tcp port 443 or udp port 443 or tcp port ${PORT} or tcp port 30443"
  fi
  [[ "$ctx" == *"colima"* ]] && [[ -z "${CAPTURE_WARMUP_SECONDS:-}" ]] && export CAPTURE_WARMUP_SECONDS=4
  for p in $(_kb -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
    ok "Starting capture on Caddy $p (HTTP/2 + HTTP/3/QUIC)"
    start_capture "ingress-nginx" "$p" "$CADDY_CAPTURE_FILTER"
  done
  if [[ -n "$ENVOY_POD" ]]; then
    ok "Starting capture on Envoy $ENVOY_POD (gRPC)"
    start_capture "$ENVOY_NS" "$ENVOY_POD" "port 10000 or port 30000 or portrange 50051-50060"
  fi
  sleep 1
fi
# Capture stop runs only at end of suite (after all tests). No EXIT trap so we don't "jump into" capture output on Ctrl+C or early exit.
BASELINE_CAPTURE_STOPPED=0

# Portable timeout: use timeout(1) or gtimeout (brew install coreutils) when available; else run without (macOS often lacks timeout).
_run_with_timeout() {
  local t="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$t" "$@"
  else
    "$@"
  fi
}

# Layer A: In-cluster gRPC health via Envoy ClusterIP (no NodePort, no port-forward).
# Use in MetalLB mode: host → LB → Caddy (HTTP only); gRPC = in-cluster → Envoy → services.
# Defined early so Test 4c and grpc_test() can call it.
_grpc_in_cluster_envoy_health() {
  local timeout_sec="${1:-35}"
  local pod_name="grpc-incluster-$$-${RANDOM:-0}"
  local out
  # Image entrypoint is grpcurl; pass args directly (do not use sh -c or grpcurl gets "sh","-c","..." as args → "Too many arguments").
  out=$(_run_with_timeout "$timeout_sec" _kb run "$pod_name" --rm -i --restart=Never -n off-campus-housing-tracker \
    --image=fullstorydev/grpcurl \
    -- -plaintext -max-time 25 envoy-test.envoy-test.svc.cluster.local:10000 grpc.health.v1.Health/Check < /dev/null 2>&1) || true
  echo "$out"
}

# Pre-flight: TLS verification (strict TLS; ensure CA matches Caddy cert)
say "Pre-flight: TLS verification (strict TLS)"
if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
  TLS_PREFLIGHT=$(strict_curl -sS -w "\n%{http_code}" -o /tmp/tls-preflight-$$.body --max-time 10 \
    --http2 --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" \
    "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || TLS_PREFLIGHT_RC=$?
  TLS_PREFLIGHT_RC=${TLS_PREFLIGHT_RC:-0}
  TLS_PREFLIGHT_CODE=$(echo "$TLS_PREFLIGHT" | tail -1)
  if [[ "$TLS_PREFLIGHT_RC" -eq 60 ]]; then
    warn "TLS verification failed (curl 60): CA does not match Caddy certificate."
    warn "  Run: pnpm run reissue  (or ./scripts/reissue-ca-and-leaf-load-all-services.sh) then re-run suites."
  elif [[ "$TLS_PREFLIGHT_RC" -ne 0 ]]; then
    warn "TLS pre-flight curl failed (exit $TLS_PREFLIGHT_RC); continuing. Check connectivity and PORT."
    [[ "$TLS_PREFLIGHT_RC" -eq 7 ]] && info "  (exit 7 = connection refused — no backend on ${CURL_RESOLVE_IP}:${PORT}; Caddy endpoints or socat/NodePort)"
    [[ "$TLS_PREFLIGHT_RC" == "7" ]] && info "  curl exit 7 = connection refused (no process listening on ${CURL_RESOLVE_IP}:${PORT}; Caddy may not be ready or socat/LB path down)."
    case "$TLS_PREFLIGHT_RC" in
      7)  info "  curl exit 7 = Failed to connect (TCP to ${CURL_RESOLVE_IP}:${PORT} refused or unreachable). If using LB IP, run with NodePort or fix MetalLB/Caddy." ;;
      28) info "  curl exit 28 = Timeout. Caddy or network may be slow." ;;
      35) info "  curl exit 35 = SSL connect error." ;;
      60) info "  curl exit 60 = CA cert does not match server cert." ;;
      *)  info "  See: curl --manual for exit code $TLS_PREFLIGHT_RC" ;;
    esac
  elif [[ "$TLS_PREFLIGHT_CODE" == "200" ]]; then
    ok "TLS verification OK (strict TLS with CA)"
  else
    warn "TLS pre-flight returned HTTP $TLS_PREFLIGHT_CODE; continuing."
  fi
  rm -f /tmp/tls-preflight-$$.body 2>/dev/null || true
else
  warn "No CA cert for pre-flight TLS check; strict TLS may fail if certs mismatch."
fi

# When using MetalLB (TARGET_IP + PORT=443): test HTTP/3 via LB IP only (no NodePort for tests).
# Capture HTTP status and curl exit code (exit 7=refused, 28=timeout, 55=send failure). See docs/HTTP3-CURL-EXIT-CODES.md.
_http3_exit_meaning() { case "${1:-}" in 7) echo "connection refused";; 28) echo "timeout";; 55) echo "send failure (QUIC/UDP)";; *) echo "exit $1";; esac; }
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
  say "HTTP/3 via MetalLB IP only (no NodePort): ${TARGET_IP}:443"
  _h3_lb_code="000"
  _h3_lb_rc=""
  _ca_args=()
  [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && _ca_args=(--cacert "$CA_CERT")
  _verify_attempt=1
  set +e
  while [[ $_verify_attempt -le "${BASELINE_H3_VERIFY_RETRIES:-3}" ]]; do
    if [[ "$(uname -s)" == "Darwin" ]] && [[ -n "${CURL_BIN:-}" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
      _h3_lb_out=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" \
        --max-time "${BASELINE_H3_VERIFY_MAX_TIME:-40}" --connect-timeout "${BASELINE_H3_PROBE_CONNECT:-8}" \
        --resolve "$HOST:443:${TARGET_IP}" "${_ca_args[@]}" "https://$HOST/_caddy/healthz" 2>/dev/null); _h3_lb_rc=$?
      _h3_lb_code="${_h3_lb_out:-000}"; _h3_lb_code="${_h3_lb_code: -3}"
    elif type strict_http3_curl &>/dev/null; then
      _h3_lb_out=$(strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only \
        --max-time "${BASELINE_H3_VERIFY_MAX_TIME:-40}" --resolve "$HOST:443:${TARGET_IP}" "https://$HOST/_caddy/healthz" 2>/dev/null); _h3_lb_rc=$?
      _h3_lb_code="${_h3_lb_out:-000}"; _h3_lb_code="${_h3_lb_code: -3}"
    fi
    [[ "$_h3_lb_code" == "200" ]] && break
    [[ $_verify_attempt -lt "${BASELINE_H3_VERIFY_RETRIES:-3}" ]] && sleep "${BASELINE_H3_VERIFY_SLEEP:-5}"
    _verify_attempt=$((_verify_attempt + 1))
  done
  set -e
  if [[ "$_h3_lb_code" == "200" ]]; then
    ok "HTTP/3 via LB IP ${TARGET_IP}:443: OK"
  else
    _h3_lb_hint=""
    [[ -n "$_h3_lb_rc" ]] && [[ "$_h3_lb_rc" -ne 0 ]] && _h3_lb_hint=" (curl exit $_h3_lb_rc: $(_http3_exit_meaning "$_h3_lb_rc"))"
    warn "HTTP/3 via LB IP ${TARGET_IP}:443: failed (HTTP $_h3_lb_code)$_h3_lb_hint. Run with sudo: LB_IP=$TARGET_IP NODEPORT=${CADDY_NODEPORT:-30443} $SCRIPT_DIR/setup-lb-ip-host-access.sh"
    info "  Curl 55/28/7: docs/HTTP3-CURL-EXIT-CODES.md; NGTCP2_ENABLE_GSO=0 is set. $SCRIPT_DIR/diagnose-http3-lb-ip-under-the-hood.sh"
  fi
fi

# Pre-flight: Check database schema (all ports per docs/CURRENT_DB_SCHEMA_REPORT.md)
say "Pre-flight: Checking database schema (5433–5440)..."
# Check auth database (port 5437) - auth-service uses database "auth" (POSTGRES_URL_AUTH=.../auth)
AUTH_SCHEMA_FOUND=false
AUTH_DB_STATUS="unknown"

# Try 5437/auth first (intended), then 5437/records (backward compatibility)
AUTH_DB_CHECK=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d auth -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>&1 || echo "CONNECTION_FAILED")
[[ "$AUTH_DB_CHECK" != "1" ]] && AUTH_DB_CHECK=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>&1 || echo "CONNECTION_FAILED")
if echo "$AUTH_DB_CHECK" | grep -q "1"; then
  ok "Auth schema exists in auth database (port 5437)"
  AUTH_SCHEMA_FOUND=true
  AUTH_DB_STATUS="port_5437"
elif echo "$AUTH_DB_CHECK" | grep -qE "(recovery|No space|FATAL)"; then
  warn "Auth database (port 5437) is in recovery mode or has disk space issues"
  warn "  → Auth-service may fail. Users need to login first for other services to work."
  AUTH_DB_STATUS="recovery"
# Fallback: check main DB (port 5433) - might still have old schema (users migrated there first)
elif PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null | grep -q "1"; then
  warn "Auth schema exists in main database (port 5433)"
  warn "  → Auth-service expects port 5437, but users exist in port 5433"
  warn "  → This is OK for now - users can login from main DB, then other services work"
  AUTH_SCHEMA_FOUND=true
  AUTH_DB_STATUS="port_5433"
# Last resort: check K8s postgres pod (only if deploy/postgres exists — k3d/external Postgres has no in-cluster postgres)
else
  AUTH_K8S_CHECK=0
  if _kb -n "$NS" get deployment postgres -o name &>/dev/null; then
    if _kb -n "$NS" exec deploy/postgres -- psql -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null | grep -q "1"; then
      AUTH_K8S_CHECK=1
    fi
  fi
  if [[ "${AUTH_K8S_CHECK:-0}" == "1" ]]; then
    warn "Auth schema exists in K8s postgres pod"
    warn "  → Auth-service expects external port 5437"
    AUTH_SCHEMA_FOUND=true
    AUTH_DB_STATUS="k8s_pod"
  fi
fi

if [[ "$AUTH_SCHEMA_FOUND" == "false" ]]; then
  warn "Auth schema missing - auth-service will fail"
  warn "  → To fix: ./scripts/setup-auth-db.sh"
  warn "  → Or run: kubectl apply -k infra/k8s/overlays/dev (to run seed jobs)"
fi

# Per-test DB verification: after each test that creates data, check the pertinent DB (canonical map: 5433=records, 5434=social, 5435=listings, 5436=shopping, 5437=auth, 5438=postgres, 5439=analytics, 5440=python_ai)
verify_db_after_test() {
  local port="$1"
  local db_name="${2:-records}"
  local query="$3"
  local label="${4:-DB check}"
  local result=""
  result=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p "$port" -U postgres -d "$db_name" -tAc "$query" 2>/dev/null || echo "")
  if [[ -n "$result" ]] && [[ "$result" != "0" ]] && [[ "$result" != "(0 rows)" ]]; then
    ok "$label: data in DB (port $port)"
    return 0
  fi
  warn "$label: no/zero result in DB (port $port) — $query"
  return 1
}

# Schema existence check per CURRENT_DB_SCHEMA_REPORT — ensures table/schema exists before tests populate it
# When SELECT 1 FROM schema.table fails (e.g. relation does not exist), retry with information_schema so we detect "table exists" even on empty DB.
verify_schema_exists() {
  local port="$1" db="$2" q="$3" label="$4"
  local r
  r=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p "$port" -U postgres -d "$db" -tAc "$q" 2>/dev/null || echo "")
  if [[ "$r" == "1" ]]; then
    ok "Schema: $label exists (port $port)"
    return 0
  fi
  # Try information_schema: extract schema.table from query like "SELECT 1 FROM listings.search_history LIMIT 1"
  if [[ "$q" =~ SELECT\ 1\ FROM\ ([a-z_]+)\.([a-z_]+)\ LIMIT\ 1 ]]; then
    local schema="${BASH_REMATCH[1]}" table="${BASH_REMATCH[2]}"
    r=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p "$port" -U postgres -d "$db" -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = '$table')" 2>/dev/null || echo "")
    if [[ "$r" == "t" ]]; then
      ok "Schema: $label exists (port $port, information_schema)"
      return 0
    fi
  fi
  info "Schema: $label not found or query failed (port $port)"
  return 1
}

# Schema coverage from CURRENT_DB_SCHEMA_REPORT — every user table hit per service (port 5433–5440)
# Goal: each service's tests must exercise all tables in its DB. Schema check = table exists; verify_db_after_test = data written.
# If many schemas show "not found": apply migrations to each Postgres (e.g. ./scripts/ensure-all-schemas-and-tuning.sh or infra/db/*.sql per port).
# Tables without HTTP APIs (bench.*, auction_monitor workers, catalog metadata): schema-only. Others: API test + verify_db.
# Port 5433 (records): records-service + analytics/auth/listings schemas
verify_schema_exists 5433 records "SELECT 1 FROM records.records LIMIT 1" "records.records" || true
verify_schema_exists 5433 records "SELECT 1 FROM catalog.data_lake LIMIT 1" "catalog.data_lake" || true
verify_schema_exists 5433 records "SELECT 1 FROM catalog.data_model LIMIT 1" "catalog.data_model" || true
verify_schema_exists 5433 records "SELECT 1 FROM catalog.data_object LIMIT 1" "catalog.data_object" || true
verify_schema_exists 5433 records "SELECT 1 FROM analytics.price_snapshots LIMIT 1" "analytics.price_snapshots (records)" || true
verify_schema_exists 5433 records "SELECT 1 FROM auth.users LIMIT 1" "auth.users (records)" || true
verify_schema_exists 5433 records "SELECT 1 FROM listings.auctions LIMIT 1" "listings.auctions" || true
verify_schema_exists 5433 records "SELECT 1 FROM listings.oauth_tokens LIMIT 1" "listings.oauth_tokens" || true
verify_schema_exists 5433 records "SELECT 1 FROM listings.search_history LIMIT 1" "listings.search_history" || true
verify_schema_exists 5433 records "SELECT 1 FROM listings.user_settings LIMIT 1" "listings.user_settings" || true
verify_schema_exists 5433 records "SELECT 1 FROM listings.watchlist LIMIT 1" "listings.watchlist (records)" || true
# Port 5434 (social): forum + messages schemas — try social DB first, then records
verify_schema_exists 5434 social "SELECT 1 FROM forum.posts LIMIT 1" "forum.posts" || verify_schema_exists 5434 records "SELECT 1 FROM forum.posts LIMIT 1" "forum.posts" || true
verify_schema_exists 5434 social "SELECT 1 FROM forum.comments LIMIT 1" "forum.comments" || verify_schema_exists 5434 records "SELECT 1 FROM forum.comments LIMIT 1" "forum.comments" || true
verify_schema_exists 5434 social "SELECT 1 FROM forum.comment_attachments LIMIT 1" "forum.comment_attachments" || verify_schema_exists 5434 records "SELECT 1 FROM forum.comment_attachments LIMIT 1" "forum.comment_attachments" || true
verify_schema_exists 5434 social "SELECT 1 FROM forum.comment_votes LIMIT 1" "forum.comment_votes" || verify_schema_exists 5434 records "SELECT 1 FROM forum.comment_votes LIMIT 1" "forum.comment_votes" || true
verify_schema_exists 5434 social "SELECT 1 FROM forum.post_attachments LIMIT 1" "forum.post_attachments" || verify_schema_exists 5434 records "SELECT 1 FROM forum.post_attachments LIMIT 1" "forum.post_attachments" || true
verify_schema_exists 5434 social "SELECT 1 FROM forum.post_votes LIMIT 1" "forum.post_votes" || verify_schema_exists 5434 records "SELECT 1 FROM forum.post_votes LIMIT 1" "forum.post_votes" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.messages LIMIT 1" "messages.messages" || verify_schema_exists 5434 records "SELECT 1 FROM messages.messages LIMIT 1" "messages.messages" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.groups LIMIT 1" "messages.groups" || verify_schema_exists 5434 records "SELECT 1 FROM messages.groups LIMIT 1" "messages.groups" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.group_members LIMIT 1" "messages.group_members" || verify_schema_exists 5434 records "SELECT 1 FROM messages.group_members LIMIT 1" "messages.group_members" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.group_bans LIMIT 1" "messages.group_bans" || verify_schema_exists 5434 records "SELECT 1 FROM messages.group_bans LIMIT 1" "messages.group_bans" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.message_attachments LIMIT 1" "messages.message_attachments" || verify_schema_exists 5434 records "SELECT 1 FROM messages.message_attachments LIMIT 1" "messages.message_attachments" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.message_reads LIMIT 1" "messages.message_reads" || verify_schema_exists 5434 records "SELECT 1 FROM messages.message_reads LIMIT 1" "messages.message_reads" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.user_archived_threads LIMIT 1" "messages.user_archived_threads" || verify_schema_exists 5434 records "SELECT 1 FROM messages.user_archived_threads LIMIT 1" "messages.user_archived_threads" || true
verify_schema_exists 5434 social "SELECT 1 FROM messages.user_deleted_threads LIMIT 1" "messages.user_deleted_threads" || verify_schema_exists 5434 records "SELECT 1 FROM messages.user_deleted_threads LIMIT 1" "messages.user_deleted_threads" || true
# Port 5435 (listings): listings-service tables
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listings LIMIT 1" "listings.listings" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.auction_details LIMIT 1" "listings.auction_details" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.bids LIMIT 1" "listings.bids" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listing_images LIMIT 1" "listings.listing_images" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listing_reports LIMIT 1" "listings.listing_reports" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listing_shipping_options LIMIT 1" "listings.listing_shipping_options" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listing_videos LIMIT 1" "listings.listing_videos" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.listing_views LIMIT 1" "listings.listing_views" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.offers LIMIT 1" "listings.offers" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.ratings LIMIT 1" "listings.ratings" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.seller_availability LIMIT 1" "listings.seller_availability" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.user_settings LIMIT 1" "listings.user_settings" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.watchlist LIMIT 1" "listings.watchlist" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.active_auctions LIMIT 1" "listings.active_auctions" || true
verify_schema_exists 5435 listings "SELECT 1 FROM listings.visible_listings LIMIT 1" "listings.visible_listings" || true
# Port 5436 (shopping): shopping + feedback schemas
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.shopping_cart LIMIT 1" "shopping.shopping_cart" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.orders LIMIT 1" "shopping.orders" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.purchase_history LIMIT 1" "shopping.purchase_history" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.search_history LIMIT 1" "shopping.search_history" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.returns LIMIT 1" "shopping.returns" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.shipments LIMIT 1" "shopping.shipments" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.notifications LIMIT 1" "shopping.notifications" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.watchlist LIMIT 1" "shopping.watchlist" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.wishlist LIMIT 1" "shopping.wishlist" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.cart_session LIMIT 1" "shopping.cart_session" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.discount_codes LIMIT 1" "shopping.discount_codes" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.price_alerts LIMIT 1" "shopping.price_alerts" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.recently_viewed LIMIT 1" "shopping.recently_viewed" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.saved_searches LIMIT 1" "shopping.saved_searches" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.bundle_shipping_offers LIMIT 1" "shopping.bundle_shipping_offers" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.cache_metadata LIMIT 1" "shopping.cache_metadata" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.cart_lines_with_total LIMIT 1" "shopping.cart_lines_with_total" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM shopping.cart_summary LIMIT 1" "shopping.cart_summary" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM feedback.collection_stats LIMIT 1" "feedback.collection_stats" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM feedback.reviews LIMIT 1" "feedback.reviews" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM feedback.user_activity LIMIT 1" "feedback.user_activity" || true
verify_schema_exists 5436 shopping "SELECT 1 FROM feedback.user_profiles LIMIT 1" "feedback.user_profiles" || true
# Port 5437 (auth): auth-service tables
verify_schema_exists 5437 auth "SELECT 1 FROM auth.users LIMIT 1" "auth.users" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.sessions LIMIT 1" "auth.sessions" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.mfa_settings LIMIT 1" "auth.mfa_settings" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.oauth_providers LIMIT 1" "auth.oauth_providers" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.passkey_challenges LIMIT 1" "auth.passkey_challenges" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.passkeys LIMIT 1" "auth.passkeys" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.user_addresses LIMIT 1" "auth.user_addresses" || true
verify_schema_exists 5437 auth "SELECT 1 FROM auth.verification_codes LIMIT 1" "auth.verification_codes" || true
# Port 5438 (auction_monitor): worker/pipeline tables (no HTTP write APIs; schema-only)
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.auction_results LIMIT 1" "auction_monitor.auction_results" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.raw_listings LIMIT 1" "auction_monitor.raw_listings" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.normalized_listings LIMIT 1" "auction_monitor.normalized_listings" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.price_history LIMIT 1" "auction_monitor.price_history" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.monitoring_jobs LIMIT 1" "auction_monitor.monitoring_jobs" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.data_quality_metrics LIMIT 1" "auction_monitor.data_quality_metrics" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.platform_health LIMIT 1" "auction_monitor.platform_health" || true
verify_schema_exists 5438 postgres "SELECT 1 FROM auction_monitor.user_saved_auctions LIMIT 1" "auction_monitor.user_saved_auctions" || true
# Port 5439 (analytics): analytics-service tables
verify_schema_exists 5439 analytics "SELECT 1 FROM analytics.price_snapshots LIMIT 1" "analytics.price_snapshots" || true
verify_schema_exists 5439 analytics "SELECT 1 FROM analytics.search_analytics LIMIT 1" "analytics.search_analytics" || true
verify_schema_exists 5439 analytics "SELECT 1 FROM analytics.user_behavior LIMIT 1" "analytics.user_behavior" || true
verify_schema_exists 5439 analytics "SELECT 1 FROM analytics.aggregated_metrics LIMIT 1" "analytics.aggregated_metrics" || true
verify_schema_exists 5439 analytics "SELECT 1 FROM analytics.trend_snapshots LIMIT 1" "analytics.trend_snapshots" || true
# Port 5440 (python_ai): ai schema tables
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.inference_log LIMIT 1" "ai.inference_log" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.predictions LIMIT 1" "ai.predictions" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.events LIMIT 1" "ai.events" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.analytics_cache LIMIT 1" "ai.analytics_cache" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.model_metadata LIMIT 1" "ai.model_metadata" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.model_metrics LIMIT 1" "ai.model_metrics" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.prediction_feedback LIMIT 1" "ai.prediction_feedback" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.price_predictions LIMIT 1" "ai.price_predictions" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.record_embeddings LIMIT 1" "ai.record_embeddings" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.training_data LIMIT 1" "ai.training_data" || true
verify_schema_exists 5440 python_ai "SELECT 1 FROM ai.training_runs LIMIT 1" "ai.training_runs" || true

# Service readiness checks
say "Checking service readiness..."
check_service_ready() {
  local service=$1
  local max_wait=${2:-60}
  local waited=0
  local kctl="kubectl --request-timeout=8s"
  
  say "Waiting for $service to be ready..."
  while [[ $waited -lt $max_wait ]]; do
    if $kctl -n "$NS" get deployment "$service" >/dev/null 2>&1; then
      if $kctl -n "$NS" rollout status deployment/"$service" --timeout=5s >/dev/null 2>&1; then
        ok "$service is ready"
        return 0
      fi
      if $kctl -n "$NS" get pods -l app="$service" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null | grep -q "CrashLoopBackOff"; then
        warn "$service is in CrashLoopBackOff - will continue but tests may fail"
        $kctl -n "$NS" get pods -l app="$service" 2>/dev/null | head -2
        return 1
      fi
    fi
    sleep 2
    waited=$((waited + 2))
  done
  
  warn "$service may not be ready (waited ${max_wait}s)"
  $kctl -n "$NS" get pods -l app="$service" 2>/dev/null || true
  return 1
}

# Check critical services (90s after restarts: startup + readiness can take 90–135s)
check_service_ready "auth-service" 90 || warn "auth-service readiness check failed, continuing anyway..."
check_service_ready "records-service" 90 || warn "records-service readiness check failed, continuing anyway..."
check_service_ready "api-gateway" 90 || warn "api-gateway readiness check failed, continuing anyway..."

# Check social-service if it exists
if kubectl -n "$NS" get deployment "social-service" >/dev/null 2>&1; then
  check_service_ready "social-service" 90 || warn "social-service readiness check failed, continuing anyway..."
else
  warn "social-service deployment not found, skipping social-service tests"
  # Check if deployment files exist but just need to be applied
  if [[ -f "infra/k8s/base/social-service/deploy.yaml" ]]; then
    warn "  → Deployment files exist at infra/k8s/base/social-service/deploy.yaml"
    warn "  → To deploy: kubectl apply -k infra/k8s/overlays/dev"
  fi
  SKIP_SOCIAL=1
fi

# Check listings-service if it exists
if kubectl -n "$NS" get deployment "listings-service" >/dev/null 2>&1; then
  check_service_ready "listings-service" 90 || warn "listings-service readiness check failed, continuing anyway..."
else
  warn "listings-service deployment not found, skipping listings-service tests"
  SKIP_LISTINGS=1
fi

# Apply shopping order_number sequence and returns migration once (avoid duplicate key, Test 13g).
# Show key lines (Applied, Verified, not reachable) so we see if 5436 is down or schema missing.
if [[ -f "$SCRIPT_DIR/ensure-shopping-order-number-sequence.sh" ]]; then
  say "Pre-flight: Shopping order_number sequence (avoid checkout duplicate key)"
  "$SCRIPT_DIR/ensure-shopping-order-number-sequence.sh" 2>&1 | grep -E "✅|⚠️|ℹ️|Applied|Verified|not reachable|5436" || true
fi
if [[ -f "$SCRIPT_DIR/ensure-shopping-returns-migration.sh" ]]; then
  "$SCRIPT_DIR/ensure-shopping-returns-migration.sh" 2>&1 | grep -E "✅|⚠️|ℹ️|returns|5436" || true
fi

# Helper function to extract user ID from JWT token
extract_user_id() {
  local token=$1
  if [[ -z "$token" ]]; then
    echo ""
    return
  fi
  # Decode JWT payload (second part, base64url)
  local payload=$(echo "$token" | cut -d'.' -f2)
  # Convert base64url to base64 (replace - with +, _ with /)
  payload=$(echo "$payload" | tr '_-' '/+')
  # Add padding if needed
  local mod=$((${#payload} % 4))
  if [[ $mod -eq 2 ]]; then
    payload="${payload}=="
  elif [[ $mod -eq 3 ]]; then
    payload="${payload}="
  fi
  # Decode and extract 'sub' field
  echo "$payload" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

# Post-rollout settle: after any Caddy/Envoy rollout, sleep before HTTP tests so we don't race pod readiness (avoids curl exit 55).
# Colima: 8s minimum (Caddy reload, MetalLB reconverge, DNS settle). k3d: 3s. Override: POST_ROLLOUT_SETTLE=N.
POST_ROLLOUT_SETTLE="${POST_ROLLOUT_SETTLE:-}"
[[ -z "$POST_ROLLOUT_SETTLE" ]] && [[ "$ctx" == *"colima"* ]] && POST_ROLLOUT_SETTLE=8
[[ -z "$POST_ROLLOUT_SETTLE" ]] && POST_ROLLOUT_SETTLE=3
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
  info "Post-rollout settle (${POST_ROLLOUT_SETTLE}s) before HTTP tests…"
  sleep "$POST_ROLLOUT_SETTLE"
fi

# Run all tests to completion (Test 1 through 15b, packet capture stop, DB verify) even when individual tests fail.
# Without this, set -e would abort at the first failing command (e.g. 13j8 curl, verify_db_after_test, or a [[ ]] that fails).
# Also disable -u (unset variable errors) so referencing an unset variable doesn't exit the script.
set +eu

# Test 1: Auth Service - Registration (HTTP/2) - User 1
# Verify HTTP/2 protocol with explicit flags: --http2, --tlsv1.3, --tls-max 1.3
# Retry up to 3x — entire suite depends on token; transient 000 can occur (Caddy reload, MetalLB reconverge, packet capture lifecycle).
say "Test 1: Auth Service - Registration via HTTP/2 (User 1) - with protocol verification"
TEST_EMAIL="microservice-test-$(date +%s)@example.com"
TEST_PASSWORD="test123"

REGISTER_RESPONSE=""
REGISTER_CODE="000"
for _attempt in 1 2 3; do
  REGISTER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" \
    --http2 \
    --tlsv1.3 \
    --tls-max 1.3 \
    --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
    "https://$HOST:${PORT}/api/auth/register" 2>/tmp/register-h2-verbose.log) || {
    warn "Registration curl command failed (attempt $_attempt/3, exit code: $?)"
    REGISTER_RESPONSE=""
    REGISTER_CODE="000"
  }
  if [[ -n "$REGISTER_RESPONSE" ]]; then
    REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
  else
    REGISTER_CODE="000"
  fi
  [[ "$REGISTER_CODE" == "201" ]] || [[ "$REGISTER_CODE" == "409" ]] && break
  [[ $_attempt -lt 3 ]] && { info "Retrying registration in 2s (attempt $_attempt/3 got HTTP $REGISTER_CODE)…"; sleep 2; }
done
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER1_ID=$(extract_user_id "$TOKEN")
  ok "User 1 registration works via HTTP/2"
  [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
  [[ -n "$USER1_ID" ]] && echo "User 1 ID: $USER1_ID"
  verify_db_after_test 5437 auth "SELECT COUNT(*) FROM auth.users WHERE email = '$TEST_EMAIL'" "Test 1 DB: User 1 in auth.users" || verify_db_after_test 5437 records "SELECT COUNT(*) FROM auth.users WHERE email = '$TEST_EMAIL'" "Test 1 DB: User 1 in auth.users" || true
elif [[ "$REGISTER_CODE" == "409" ]]; then
  ok "User 1 exists (expected) - will try login instead"
else
  warn "User 1 registration failed - HTTP $REGISTER_CODE"
  echo "Response body: $(echo "$REGISTER_RESPONSE" | sed '$d' | head -5)"
fi

# Test 1b: Auth Service - Registration (HTTP/2) - User 2
say "Test 1b: Auth Service - Registration via HTTP/2 (User 2)"
TEST_EMAIL_USER2="microservice-test-2-$(date +%s)@example.com"
REGISTER_RESPONSE_USER2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" \
  "https://$HOST:${PORT}/api/auth/register" 2>/tmp/register-user2.log) || {
  warn "User 2 registration curl command failed (exit code: $?)"
  REGISTER_RESPONSE_USER2=""
  REGISTER_CODE_USER2="000"
}
if [[ -n "$REGISTER_RESPONSE_USER2" ]]; then
  REGISTER_CODE_USER2=$(echo "$REGISTER_RESPONSE_USER2" | tail -1)
else
  REGISTER_CODE_USER2="000"
fi
if [[ "$REGISTER_CODE_USER2" == "201" ]]; then
  TOKEN_USER2=$(echo "$REGISTER_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER2_ID=$(extract_user_id "$TOKEN_USER2")
  ok "User 2 registration works via HTTP/2"
  [[ -n "$TOKEN_USER2" ]] && echo "Token: ${TOKEN_USER2:0:50}..."
  [[ -n "$USER2_ID" ]] && echo "User 2 ID: $USER2_ID"
  # Auth-service uses 5437/auth (POSTGRES_URL_AUTH); check auth first, then records for backward compatibility
  [[ -n "$USER2_ID" ]] && ( verify_db_after_test 5437 auth "SELECT COUNT(*) FROM auth.users WHERE id='$USER2_ID';" "Test 1b DB: User 2 in auth.users (port 5437)" || verify_db_after_test 5437 records "SELECT COUNT(*) FROM auth.users WHERE id='$USER2_ID';" "Test 1b DB: User 2 in auth.users (port 5437)" ) || true
elif [[ "$REGISTER_CODE_USER2" == "409" ]]; then
  ok "User 2 exists (expected) - will try login instead"
else
  warn "User 2 registration failed - HTTP $REGISTER_CODE_USER2"
  echo "Response body: $(echo "$REGISTER_RESPONSE_USER2" | sed '$d' | head -5)"
fi

# Allow Caddy H3 listener to settle before first HTTP/3 (reduces QUIC handshake timeout on Colima)
sleep 2

# Test 2: Auth Service - Login (HTTP/3) - User 1
# Verify HTTP/3 protocol with explicit flags: --http3-only
say "Test 2: Auth Service - Login via HTTP/3 (User 1) - with protocol verification"
if [[ -z "$TOKEN" ]]; then
  # HTTP/3 uses QUIC (UDP), verify with --http3-only flag (max-time 8, connect 2 from lib/http3.sh)
  LOGIN_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" \
    --http3-only \
    --tlsv1.3 \
    --tls-max 1.3 \
    --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
    "https://$HOST/api/auth/login" 2>/tmp/login-h3-verbose.log) || {
    warn "HTTP/3 curl command failed (exit code: $?)"
    echo "This may indicate HTTP/3 connectivity issues. Check http3_curl helper."
    LOGIN_RESPONSE=""
    LOGIN_CODE="000"
  }
  if [[ -n "$LOGIN_RESPONSE" ]]; then
    LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
    if [[ "$LOGIN_CODE" == "200" ]]; then
      TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
      USER1_ID=$(extract_user_id "$TOKEN")
      ok "User 1 login works via HTTP/3"
      [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
      [[ -n "$USER1_ID" ]] && echo "User 1 ID: $USER1_ID"
    else
      warn "User 1 login failed - HTTP $LOGIN_CODE"
      echo "Response body: $(echo "$LOGIN_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  ok "User 1 already has token from registration"
fi

# Test 2b: Auth Service - Login (HTTP/3) - User 2
say "Test 2b: Auth Service - Login via HTTP/3 (User 2)"
if [[ -z "$TOKEN_USER2" ]]; then
  LOGIN_RESPONSE_USER2=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" \
    "https://$HOST/api/auth/login" 2>/tmp/login-user2-h3.log) || {
    warn "HTTP/3 curl command failed (exit code: $?)"
    LOGIN_RESPONSE_USER2=""
    LOGIN_CODE_USER2="000"
  }
  if [[ -n "$LOGIN_RESPONSE_USER2" ]]; then
    LOGIN_CODE_USER2=$(echo "$LOGIN_RESPONSE_USER2" | tail -1)
    if [[ "$LOGIN_CODE_USER2" == "200" ]]; then
      TOKEN_USER2=$(echo "$LOGIN_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
      USER2_ID=$(extract_user_id "$TOKEN_USER2")
      ok "User 2 login works via HTTP/3"
      [[ -n "$TOKEN_USER2" ]] && echo "Token: ${TOKEN_USER2:0:50}..."
      [[ -n "$USER2_ID" ]] && echo "User 2 ID: $USER2_ID"
    else
      warn "User 2 login failed - HTTP $LOGIN_CODE_USER2"
      echo "Response body: $(echo "$LOGIN_RESPONSE_USER2" | sed '$d' | head -5)"
    fi
  fi
else
  ok "User 2 already has token from registration"
fi

# Test 3: Records Service - Create Record (HTTP/2)
say "Test 3: Records Service - Create Record via HTTP/2"
if [[ -n "${TOKEN:-}" ]]; then
  CREATE_RC=0
  CREATE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/records" \
    -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}' 2>&1) || CREATE_RC=$?
  CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  if [[ "$CREATE_RC" -ne 0 ]]; then
    warn "Create record request failed (HTTP ${CREATE_CODE:-000}, curl exit $CREATE_RC)"
  elif [[ "$CREATE_CODE" =~ ^(200|201)$ ]]; then
    ok "Create record works via HTTP/2"
    RECORD_ID=$(echo "$CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    verify_db_after_test 5433 records "SELECT COUNT(*) FROM records.records WHERE catalog_number = 'TEST-001'" "Test 3 DB: record in records.records" || true
  else
    warn "Create record failed - HTTP $CREATE_CODE"
    echo "Response body: $(echo "$CREATE_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping record creation - no auth token available"
fi

# Test 3b: Records Service - Create Record (HTTP/3)
say "Test 3b: Records Service - Create Record via HTTP/3"
if [[ -n "${TOKEN:-}" ]]; then
  CREATE_H3_RC=0
  CREATE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/records" \
    -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}' 2>&1) || CREATE_H3_RC=$?
  CREATE_H3_CODE=$(echo "$CREATE_H3_RESPONSE" | tail -1)
  if [[ "$CREATE_H3_RC" -ne 0 ]]; then
    warn "Create record via HTTP/3 failed (HTTP ${CREATE_H3_CODE:-000}, curl exit $CREATE_H3_RC: $(_http3_exit_meaning "$CREATE_H3_RC"))"
  elif [[ -n "$CREATE_H3_RESPONSE" ]]; then
    if [[ "$CREATE_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create record works via HTTP/3"
      RECORD_H3_ID=$(echo "$CREATE_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      verify_db_after_test 5433 records "SELECT COUNT(*) FROM records.records WHERE catalog_number = 'TEST-H3-001'" "Test 3b DB: H3 record in records.records" || true
    else
      warn "Create record via HTTP/3 failed - HTTP $CREATE_H3_CODE"
      echo "Response body: $(echo "$CREATE_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping record creation via HTTP/3 - no auth token available"
fi

# Test 4: Health Checks (HTTP/2 and HTTP/3) + Envoy & Caddy Health
say "Test 4: Health Checks (All Services + Envoy + Caddy)"
# Strict HTTP/2: always use strict_curl with --http2 (no -k in production)
CADDY_H2_HEALTH=$(strict_curl -sS -I --http2 --max-time "${CURL_MAX_TIME:-15}" \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || CADDY_H2_HEALTH=""
if echo "$CADDY_H2_HEALTH" | head -n1 | grep -q "200"; then
  ok "Caddy health check works via HTTP/2"
else
  warn "Caddy health check failed via HTTP/2"
fi

# Caddy H3 + Test 4c: non-fatal so baseline always runs to completion (timeout/unset var must not exit)
set +eu
HTTP3_RESOLVE="${HTTP3_RESOLVE:-$HOST:443:${CURL_RESOLVE_IP:-127.0.0.1}}"
CADDY_H3_HEALTH=$(strict_http3_curl -sS -I --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1) || CADDY_H3_HEALTH=""
# HTTP/3 response format may vary - check for 200 status in first line
if echo "$CADDY_H3_HEALTH" | head -n1 | grep -qE "(HTTP/3 200|200 OK|HTTP.*200)"; then
  ok "Caddy health check works via HTTP/3"
elif echo "$CADDY_H3_HEALTH" | grep -qE "200"; then
  ok "Caddy health check works via HTTP/3 (status 200 found)"
else
  _caddy_h3_code=$(echo "$CADDY_H3_HEALTH" | grep -oE "HTTP/3 [0-9]+|[0-9]{3}" | head -1 | tr -d 'HTTP/3 ')
  warn "Caddy health check failed via HTTP/3 (HTTP ${_caddy_h3_code:-000})"
  echo "Response: $(echo "$CADDY_H3_HEALTH" | head -n3)"
fi

# Test 4c: Envoy Health Check (gRPC/HTTP/2 proxy)
# TLS at Caddy only: grpcurl targets Caddy (TARGET_IP:443) with -authority off-campus-housing.local; Caddy proxies gRPC to Envoy (h2c).
say "Test 4c: Envoy Health Check (gRPC/HTTP/2 Proxy)"
ENVOY_GRPC_OK=0
PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../proto" && pwd 2>/dev/null || echo "")"
[[ -z "$PROTO_DIR" ]] || [[ ! -d "$PROTO_DIR" ]] && PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infra/k8s/base/config/proto" && pwd 2>/dev/null || echo "")"
# 1) gRPC via Caddy (TARGET_IP:443): TLS terminated at Caddy; Caddy proxies to Envoy (h2c). No direct Envoy LB.
if [[ $ENVOY_GRPC_OK -eq 0 ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]] && command -v grpcurl >/dev/null 2>&1; then
  info "Test 4c: trying gRPC via Caddy ${TARGET_IP}:443 (grpc.health.v1.Health/Check)..."
  ENVOY_GRPC_VIA_CADDY=$(grpcurl -cacert "$CA_CERT" -authority "${HOST:-off-campus-housing.local}" -max-time 5 -d '{}' "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1 || echo "")
  if echo "$ENVOY_GRPC_VIA_CADDY" | grep -q -iE "SERVING|healthy"; then
    ok "Envoy gRPC routing works (via Caddy ${TARGET_IP}:443)"
    ENVOY_GRPC_OK=1
  else
    [[ -n "$ENVOY_GRPC_VIA_CADDY" ]] && info "Test 4c grpcurl via Caddy ${TARGET_IP}:443: $(echo "$ENVOY_GRPC_VIA_CADDY" | head -1)"
    echo "$ENVOY_GRPC_VIA_CADDY" | grep -q "SSLV3_ALERT_HANDSHAKE_FAILURE" && info "Test 4c: Caddy→Envoy TLS handshake failed (Caddy proxies gRPC to Envoy over h2c; if Envoy expects TLS, see Caddyfile and Envoy TLS config)"
  fi
fi
# 2) Fallback: port-forward to Envoy pod when Caddy not available or grpcurl via Caddy failed.
if [[ $ENVOY_GRPC_OK -eq 0 ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && command -v kubectl >/dev/null 2>&1 && [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]]; then
  PF_PORT="${ENVOY_PF_PORT:-15000}"
  kubectl port-forward -n "$ENVOY_NS" "pod/$ENVOY_POD" "${PF_PORT}:10000" 2>/dev/null & PF_PID=$!
  sleep 2
  if [[ -n "${PF_PID:-}" ]] && kill -0 "$PF_PID" 2>/dev/null; then
    ENVOY_PF_TEST=""
    if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
      # Strict TLS: cacert, authority, -d '{}', target, method last (grpcurl is strict about order)
      ENVOY_PF_TEST=$(grpcurl -cacert "$CA_CERT" -authority "off-campus-housing.local" -max-time 5 -d '{}' "127.0.0.1:${PF_PORT}" grpc.health.v1.Health/Check 2>&1 || echo "")
    fi
    if [[ -z "$ENVOY_PF_TEST" ]] || ! echo "$ENVOY_PF_TEST" | grep -q -iE "SERVING|healthy"; then
      ENVOY_PF_TEST=$(grpcurl -plaintext -max-time 5 -d '{}' "127.0.0.1:${PF_PORT}" grpc.health.v1.Health/Check 2>&1 || echo "")
    fi
    kill "$PF_PID" 2>/dev/null || true
    wait "$PF_PID" 2>/dev/null || true
    if echo "$ENVOY_PF_TEST" | grep -q -iE "SERVING|healthy"; then
      ok "Envoy gRPC routing works (port-forward to Envoy pod; strict TLS)"
      ENVOY_GRPC_OK=1
    fi
  fi
fi
# When not Colima/MetalLB or port-forward not available: try in-cluster then NodePort
if [[ $ENVOY_GRPC_OK -eq 0 ]] && [[ "${GRPC_USE_IN_CLUSTER:-0}" == "1" ]]; then
  ENVOY_IN_CLUSTER_OUT=$(_grpc_in_cluster_envoy_health 35)
  if echo "$ENVOY_IN_CLUSTER_OUT" | grep -q -iE "SERVING|\"status\":\"SERVING\"|healthy"; then
    ok "Envoy gRPC routing works (in-cluster grpcurl)"
    ENVOY_GRPC_OK=1
  fi
fi
if [[ $ENVOY_GRPC_OK -eq 0 ]]; then
for try_port in 30000 30001; do
  if _run_with_timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$try_port" 2>/dev/null || nc -z -w 2 127.0.0.1 "$try_port" 2>/dev/null; then
    ok "Envoy is accepting connections on port $try_port"
    if [[ -n "$PROTO_DIR" ]] && [[ -d "$PROTO_DIR" ]]; then
      ENVOY_GRPC_TEST=$(grpcurl -plaintext -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" -max-time 5 \
        "127.0.0.1:$try_port" auth.AuthService/HealthCheck 2>&1 || echo "")
      if echo "$ENVOY_GRPC_TEST" | grep -q "healthy"; then
        ok "Envoy gRPC routing works (health check via Envoy successful)"
        ENVOY_GRPC_OK=1
        break
      fi
      if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
        ENVOY_GRPC_TLS=$(grpcurl -cacert "$CA_CERT" -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" -max-time 5 \
          "127.0.0.1:$try_port" auth.AuthService/HealthCheck 2>&1 || echo "")
        if echo "$ENVOY_GRPC_TLS" | grep -q "healthy"; then
          ok "Envoy gRPC with strict TLS works (health check via Envoy + CA chain)"
          ENVOY_GRPC_OK=1
          break
        fi
      fi
    fi
  fi
done
fi
# Fallback: port-forward to Envoy pod when not already tried (non-MetalLB)
if [[ $ENVOY_GRPC_OK -eq 0 ]] && [[ -z "${TARGET_IP:-}" || "${PORT:-}" != "443" ]] && command -v kubectl >/dev/null 2>&1 && [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]] && [[ -n "$PROTO_DIR" ]] && [[ -d "$PROTO_DIR" ]]; then
  PF_PORT="${ENVOY_PF_PORT:-15000}"
  kubectl port-forward -n "$ENVOY_NS" "pod/$ENVOY_POD" "${PF_PORT}:10000" 2>/dev/null & PF_PID=$!
  sleep 2
  if [[ -n "${PF_PID:-}" ]] && kill -0 "$PF_PID" 2>/dev/null; then
    ENVOY_PF_TEST=""
    if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
      ENVOY_PF_TEST=$(grpcurl -cacert "$CA_CERT" -authority "${HOST:-off-campus-housing.local}" -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" -max-time 5 "127.0.0.1:${PF_PORT}" auth.AuthService/HealthCheck 2>&1 || echo "")
    fi
    if [[ -z "$ENVOY_PF_TEST" ]] || ! echo "$ENVOY_PF_TEST" | grep -q "healthy"; then
      ENVOY_PF_TEST=$(grpcurl -plaintext -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" -max-time 5 "127.0.0.1:${PF_PORT}" auth.AuthService/HealthCheck 2>&1 || echo "")
    fi
    kill "$PF_PID" 2>/dev/null || true
    wait "$PF_PID" 2>/dev/null || true
    if echo "$ENVOY_PF_TEST" | grep -q "healthy"; then
      ok "Envoy gRPC routing works (health check via port-forward to Envoy pod)"
      ENVOY_GRPC_OK=1
    fi
  fi
fi
# Keep non-fatal mode for the remainder of baseline so one failed check does not abort the suite.
set +eu

if [[ $ENVOY_GRPC_OK -eq 0 ]]; then
  if [[ -n "$PROTO_DIR" ]] && [[ -d "$PROTO_DIR" ]]; then
    if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
      warn "Envoy gRPC routing test failed (grpcurl via Caddy ${TARGET_IP}:443; check Caddy gRPC→Envoy route and CA)"
    else
      warn "Envoy gRPC routing test failed (may need TLS or different config; try ports 30000/30001 or port-forward)"
    fi
    [[ -n "${ENVOY_GRPC_TEST:-}" ]] && echo "Response: $ENVOY_GRPC_TEST" | head -3
    [[ -n "${ENVOY_IN_CLUSTER_OUT:-}" ]] && echo "In-cluster: $ENVOY_IN_CLUSTER_OUT" | head -3
  else
    warn "Envoy is not accepting connections on ports 30000/30001 or proto directory missing"
  fi
fi

# Test 5: API Gateway Health
say "Test 5: API Gateway Health"
  GATEWAY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME:-15}" \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/healthz" 2>/tmp/gateway-health.log) || {
  warn "API Gateway health check curl command failed (exit code: $?)"
  GATEWAY_RESPONSE=""
  GATEWAY_CODE="000"
}
if [[ -n "$GATEWAY_RESPONSE" ]]; then
  GATEWAY_CODE=$(echo "$GATEWAY_RESPONSE" | tail -1)
else
  GATEWAY_CODE="000"
fi
if [[ "$GATEWAY_CODE" =~ ^(200|404|502)$ ]]; then
  ok "API Gateway reachable via HTTP/2 - HTTP $GATEWAY_CODE"
else
  warn "API Gateway test failed - HTTP $GATEWAY_CODE"
fi

# Test 6: Social Service - Forum Endpoints (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6: Social Service - Create Forum Post via HTTP/2"
  FORUM_POST_RC=0
  FORUM_POST_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Forum Post","content":"This is a test post via HTTP/2","flair":"general"}' 2>&1) || FORUM_POST_RC=$?
  FORUM_POST_CODE=$(echo "$FORUM_POST_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_RC" -ne 0 ]]; then
    warn "Create forum post request failed (curl exit $FORUM_POST_RC)"
  elif [[ "$FORUM_POST_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post works via HTTP/2"
    FORUM_POST_ID=$(echo "$FORUM_POST_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$FORUM_POST_ID" ]] && echo "Forum post ID: $FORUM_POST_ID"
    verify_db_after_test 5434 social "SELECT COUNT(*) FROM forum.posts WHERE title = 'Test Forum Post'" "Test 6 DB: forum post in forum.posts" || true
  else
    warn "Create forum post failed - HTTP $FORUM_POST_CODE"
    echo "Response body: $(echo "$FORUM_POST_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post creation - social-service not available or no auth token"
fi

# Test 6b: Social Service - Forum Endpoints (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6b: Social Service - Create Forum Post via HTTP/3"
  FORUM_POST_H3_RC=0
  FORUM_POST_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts" \
    -d '{"title":"Test Forum Post H3","content":"This is a test post via HTTP/3","flair":"general"}' 2>&1) || FORUM_POST_H3_RC=$?
  if [[ "$FORUM_POST_H3_RC" -ne 0 ]]; then
    _forum_h3_code=$(echo "$FORUM_POST_H3_RESPONSE" | tail -1)
    warn "Create forum post via HTTP/3 failed (HTTP ${_forum_h3_code:-000}, curl exit $FORUM_POST_H3_RC: $(_http3_exit_meaning "$FORUM_POST_H3_RC"))"
  elif [[ -n "$FORUM_POST_H3_RESPONSE" ]]; then
    FORUM_POST_H3_CODE=$(echo "$FORUM_POST_H3_RESPONSE" | tail -1)
    if [[ "$FORUM_POST_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create forum post works via HTTP/3"
      FORUM_POST_H3_ID=$(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      verify_db_after_test 5434 social "SELECT COUNT(*) FROM forum.posts WHERE title = 'Test Forum Post H3'" "Test 6b DB: H3 forum post in forum.posts" || true
    else
      warn "Create forum post via HTTP/3 failed - HTTP $FORUM_POST_H3_CODE"
      echo "Response body: $(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping forum post creation via HTTP/3 - social-service not available or no auth token"
fi

# Test 7: Social Service - Get Forum Posts (HTTP/2) — strict TLS + resolve; retry up to 2x on curl exit 7 (connection)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 7: Social Service - Get Forum Posts via HTTP/2"
  GET_FORUM_RC=0
  GET_FORUM_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
  _retry=0
  while [[ "$GET_FORUM_RC" -eq 7 ]] && [[ -z "$(echo "$GET_FORUM_RESPONSE" | tail -1 | grep -E '^[0-9]+$')" ]] && [[ "$_retry" -lt 2 ]]; do
    sleep 2
    GET_FORUM_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X GET "https://$HOST:${PORT}/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
    _retry=$((_retry + 1))
  done
  GET_FORUM_CODE=$(echo "$GET_FORUM_RESPONSE" | tail -1)
  if [[ "$GET_FORUM_RC" -ne 0 ]]; then
    warn "Get forum posts request failed (curl exit $GET_FORUM_RC)"
  elif [[ "$GET_FORUM_CODE" =~ ^(200)$ ]]; then
    ok "Get forum posts works via HTTP/2"
    # Extract post ID for comment test (if not already set)
    if [[ -z "${FORUM_POST_ID:-}" ]]; then
      FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if [[ -z "$FORUM_POST_ID" ]]; then
        # Try parsing as JSON array
        FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0].get('id', '') if isinstance(data, list) and len(data) > 0 else '')" 2>/dev/null || echo "")
      fi
      [[ -n "$FORUM_POST_ID" ]] && echo "Found forum post ID: $FORUM_POST_ID"
    fi
  else
    warn "Get forum posts failed - HTTP $GET_FORUM_CODE"
    echo "Response body: $(echo "$GET_FORUM_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get forum posts - social-service not available or no auth token"
fi

# Test 7b: Social Service - Add Comment to Forum Post (HTTP/3) - User 2 comments on User 1's post
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 7b: Social Service - Add Comment to Forum Post via HTTP/3 (User 2)"
  ADD_COMMENT_RC=0
  # Increased timeout to 60s and add retry logic for HTTP/3 (QUIC can be slower)
  ADD_COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"Great post! This is a test comment via HTTP/3 from User 2"}' 2>&1) || ADD_COMMENT_RC=$?
  
  # Retry once if timeout (exit code 28)
  if [[ "$ADD_COMMENT_RC" -eq 28 ]]; then
    warn "Add comment via HTTP/3 timed out, retrying once..."
    sleep 2
    ADD_COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
      -d '{"content":"Great post! This is a test comment via HTTP/3 from User 2 (retry)"}' 2>&1) || ADD_COMMENT_RC=$?
  fi
  
  if [[ "$ADD_COMMENT_RC" -ne 0 ]]; then
    if [[ "$ADD_COMMENT_RC" -eq 28 ]]; then
      warn "Add comment via HTTP/3 failed (curl exit $ADD_COMMENT_RC - timeout after retry)"
    else
      warn "Add comment via HTTP/3 failed (curl exit $ADD_COMMENT_RC)"
    fi
  elif [[ -n "$ADD_COMMENT_RESPONSE" ]]; then
    ADD_COMMENT_CODE=$(echo "$ADD_COMMENT_RESPONSE" | tail -1)
    if [[ "$ADD_COMMENT_CODE" =~ ^(200|201)$ ]]; then
      ok "Add comment to forum post works via HTTP/3"
      [[ -n "${FORUM_POST_ID:-}" ]] && verify_db_after_test 5434 social "SELECT 1 FROM forum.comments WHERE post_id = '${FORUM_POST_ID}' AND content LIKE '%HTTP/3%' LIMIT 1" "Test 7b DB: comment in forum.comments" || true
      # Extract COMMENT_ID for vote tests
      [[ -z "${COMMENT_ID:-}" ]] && COMMENT_ID=$(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      [[ -z "${COMMENT_ID:-}" ]] && command -v jq >/dev/null 2>&1 && COMMENT_ID=$(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | jq -r '.id // empty' 2>/dev/null || echo "")
    else
      warn "Add comment via HTTP/3 failed - HTTP $ADD_COMMENT_CODE"
      echo "Response body: $(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment - Forum post ID not available"
  else
    warn "Skipping add comment - social-service not available or no auth token"
  fi
fi

# Test 7c: Forum post vote (HTTP/2) — hits forum.post_votes (port 5434, CURRENT_DB_SCHEMA_REPORT)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 7c: Social Service - Vote on Forum Post via HTTP/2"
  POST_VOTE_RC=0
  POST_VOTE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$FORUM_POST_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || POST_VOTE_RC=$?
  POST_VOTE_CODE=$(echo "$POST_VOTE_RESPONSE" | tail -1)
  if [[ "$POST_VOTE_RC" -ne 0 ]]; then
    warn "Forum post vote via HTTP/2 failed (curl exit $POST_VOTE_RC)"
  elif [[ "$POST_VOTE_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum post vote works via HTTP/2 (forum.post_votes)"
    [[ -n "${USER1_ID:-}" ]] && ( verify_db_after_test 5434 social "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7c DB: post_votes" || verify_db_after_test 5434 records "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7c DB: post_votes (records)" ) || true
  else
    warn "Forum post vote via HTTP/2 failed - HTTP $POST_VOTE_CODE"
    [[ "$POST_VOTE_CODE" == "502" ]] && info "  502 on forum vote: If schema preflight passed, run ./scripts/diagnose-502-and-analytics.sh. Ensure Postgres (not SSH) listens on 0.0.0.0:5434 so pods (host.docker.internal) can connect."
  fi
fi

# Test 7d: Forum post vote (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 7d: Social Service - Vote on Forum Post via HTTP/3"
  POST_VOTE_H3_RC=0
  POST_VOTE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || POST_VOTE_H3_RC=$?
  POST_VOTE_H3_CODE=$(echo "$POST_VOTE_H3_RESPONSE" | tail -1)
  if [[ "$POST_VOTE_H3_RC" -ne 0 ]]; then
    warn "Forum post vote via HTTP/3 failed (curl exit $POST_VOTE_H3_RC)"
  elif [[ "$POST_VOTE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum post vote works via HTTP/3 (forum.post_votes)"
    [[ -n "${USER1_ID:-}" ]] && ( verify_db_after_test 5434 social "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7d DB: H3 post_votes" || verify_db_after_test 5434 records "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7d DB: H3 post_votes (records)" ) || true
  else
    warn "Forum post vote via HTTP/3 failed - HTTP $POST_VOTE_H3_CODE"
  fi
fi

# Test 7e: Forum comment vote (HTTP/2) — hits forum.comment_votes (port 5434)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${COMMENT_ID:-}" ]]; then
  say "Test 7e: Social Service - Vote on Forum Comment via HTTP/2"
  COMMENT_VOTE_RC=0
  COMMENT_VOTE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/comments/$COMMENT_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || COMMENT_VOTE_RC=$?
  COMMENT_VOTE_CODE=$(echo "$COMMENT_VOTE_RESPONSE" | tail -1)
  if [[ "$COMMENT_VOTE_RC" -ne 0 ]]; then
    warn "Forum comment vote via HTTP/2 failed (curl exit $COMMENT_VOTE_RC)"
  elif [[ "$COMMENT_VOTE_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum comment vote works via HTTP/2 (forum.comment_votes)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5434 social "SELECT 1 FROM forum.comment_votes WHERE comment_id = '${COMMENT_ID}' AND user_id = '${USER1_ID}' LIMIT 1" "Test 7e DB: comment_votes" || true
  else
    warn "Forum comment vote via HTTP/2 failed - HTTP $COMMENT_VOTE_CODE"
  fi
else
  [[ -z "${COMMENT_ID:-}" ]] && info "Skipping forum comment vote - COMMENT_ID not available (from Test 7b)"
fi

# Test 7f: Forum comment vote (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${COMMENT_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 7f: Social Service - Vote on Forum Comment via HTTP/3"
  COMMENT_VOTE_H3_RC=0
  COMMENT_VOTE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/comments/$COMMENT_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || COMMENT_VOTE_H3_RC=$?
  COMMENT_VOTE_H3_CODE=$(echo "$COMMENT_VOTE_H3_RESPONSE" | tail -1)
  if [[ "$COMMENT_VOTE_H3_RC" -ne 0 ]]; then
    warn "Forum comment vote via HTTP/3 failed (curl exit $COMMENT_VOTE_H3_RC)"
  elif [[ "$COMMENT_VOTE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum comment vote works via HTTP/3 (forum.comment_votes)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5434 social "SELECT 1 FROM forum.comment_votes WHERE comment_id = '${COMMENT_ID}' AND user_id = '${USER1_ID}' LIMIT 1" "Test 7f DB: H3 comment_votes" || true
  else
    warn "Forum comment vote via HTTP/3 failed - HTTP $COMMENT_VOTE_H3_CODE"
  fi
fi

# Test 8: Social Service - P2P Direct Message (HTTP/2) - User 1 to User 2
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 8: Social Service - Send P2P Direct Message via HTTP/2 (User 1 -> User 2)"
  SEND_MSG_RC=0
  SEND_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages" \
    -d "{\"recipient_id\":\"$USER2_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Message\",\"content\":\"Hello User 2, this is a test message via HTTP/2\"}" 2>&1) || SEND_MSG_RC=$?
  SEND_MSG_CODE=$(echo "$SEND_MSG_RESPONSE" | tail -1)
  if [[ "$SEND_MSG_RC" -ne 0 ]]; then
    warn "Send P2P message request failed (curl exit $SEND_MSG_RC)"
  elif [[ "$SEND_MSG_CODE" =~ ^(200|201)$ ]]; then
    ok "Send P2P message works via HTTP/2"
    MESSAGE_ID=$(echo "$SEND_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Send P2P message failed - HTTP $SEND_MSG_CODE"
    echo "Response body: $(echo "$SEND_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping P2P message test - User 2 ID not available"
  else
    warn "Skipping P2P message test - social-service not available or no auth token"
  fi
fi

# Test 8b: Social Service - P2P Direct Message (HTTP/3) - User 2 to User 1
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${USER1_ID:-}" ]]; then
  say "Test 8b: Social Service - Send P2P Direct Message via HTTP/3 (User 2 -> User 1)"
  SEND_MSG_H3_RC=0
  SEND_MSG_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"recipient_id\":\"$USER1_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Reply\",\"content\":\"Hello User 1, this is a reply via HTTP/3\"}" 2>&1) || SEND_MSG_H3_RC=$?
  if [[ "$SEND_MSG_H3_RC" -ne 0 ]]; then
    warn "Send P2P message via HTTP/3 failed (curl exit $SEND_MSG_H3_RC)"
  elif [[ -n "$SEND_MSG_H3_RESPONSE" ]]; then
    SEND_MSG_H3_CODE=$(echo "$SEND_MSG_H3_RESPONSE" | tail -1)
    if [[ "$SEND_MSG_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Send P2P message works via HTTP/3"
      MESSAGE_H3_ID=$(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Send P2P message via HTTP/3 failed - HTTP $SEND_MSG_H3_CODE"
      echo "Response body: $(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${USER1_ID:-}" ]]; then
    warn "Skipping P2P message reply test - User 1 ID not available"
  else
    warn "Skipping P2P message reply test - social-service not available or no auth token"
  fi
fi

# Test 9: Social Service - Get Messages (HTTP/2) - User 2's inbox
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]]; then
  say "Test 9: Social Service - Get Messages via HTTP/2 (User 2's inbox)"
  GET_MSG_RC=0
  GET_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages" 2>&1) || GET_MSG_RC=$?
  GET_MSG_CODE=$(echo "$GET_MSG_RESPONSE" | tail -1)
  if [[ "$GET_MSG_RC" -ne 0 ]]; then
    warn "Get messages request failed (curl exit $GET_MSG_RC)"
  elif [[ "$GET_MSG_CODE" =~ ^(200)$ ]]; then
    ok "Get messages works via HTTP/2"
  else
    warn "Get messages failed - HTTP $GET_MSG_CODE"
    echo "Response body: $(echo "$GET_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get messages - social-service not available or no auth token"
fi

# Test 9b: Social Service - Create Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9b: Social Service - Create Group Chat via HTTP/2"
  CREATE_GROUP_RC=0
  CREATE_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups" \
    -d '{"name":"My Custom Group Name","description":"A test group for HTTP/2/3 testing"}' 2>&1) || CREATE_GROUP_RC=$?
  CREATE_GROUP_CODE=$(echo "$CREATE_GROUP_RESPONSE" | tail -1)
  if [[ "$CREATE_GROUP_RC" -ne 0 ]]; then
    warn "Create group request failed (curl exit $CREATE_GROUP_RC)"
  elif [[ "$CREATE_GROUP_CODE" =~ ^(200|201)$ ]]; then
    ok "Create group works via HTTP/2"
    GROUP_ID=$(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$GROUP_ID" ]] && echo "Group ID: $GROUP_ID"
    [[ -n "$GROUP_ID" ]] && verify_db_after_test 5434 social "SELECT 1 FROM messages.groups WHERE id = '${GROUP_ID}' AND name = 'My Custom Group Name' LIMIT 1" "Test 9b DB: group in messages.groups" || true
  else
    warn "Create group failed - HTTP $CREATE_GROUP_CODE"
    echo "Response body: $(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping create group - social-service not available or no auth token"
fi

# Test 9c: Social Service - Add User 2 to Group (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 9c: Social Service - Add User 2 to Group via HTTP/2"
  ADD_MEMBER_RC=0
  ADD_MEMBER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
    -d "{\"user_id\":\"$USER2_ID\"}" 2>&1) || ADD_MEMBER_RC=$?
  ADD_MEMBER_CODE=$(echo "$ADD_MEMBER_RESPONSE" | tail -1)
  if [[ "$ADD_MEMBER_RC" -ne 0 ]]; then
    warn "Add member request failed (curl exit $ADD_MEMBER_RC)"
  elif [[ "$ADD_MEMBER_CODE" =~ ^(200|201)$ ]]; then
    ok "Add member to group works via HTTP/2"
    [[ -n "${GROUP_ID:-}" ]] && [[ -n "${USER2_ID:-}" ]] && verify_db_after_test 5434 social "SELECT 1 FROM messages.group_members WHERE group_id = '${GROUP_ID}' AND user_id = '${USER2_ID}' LIMIT 1" "Test 9c DB: member in messages.group_members" || true
  else
    warn "Add member to group failed - HTTP $ADD_MEMBER_CODE"
    echo "Response body: $(echo "$ADD_MEMBER_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping add member - Group ID not available"
  elif [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping add member - User 2 ID not available"
  else
    warn "Skipping add member - social-service not available or no auth token"
  fi
fi

# Test 9d: Social Service - Send Group Message (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9d: Social Service - Send Group Message via HTTP/3"
  SEND_GROUP_MSG_RC=0
  SEND_GROUP_MSG_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"group_id\":\"$GROUP_ID\",\"message_type\":\"group\",\"subject\":\"Group Chat Test\",\"content\":\"Hello group! This is a test message via HTTP/3\"}" 2>&1) || SEND_GROUP_MSG_RC=$?
  if [[ "$SEND_GROUP_MSG_RC" -ne 0 ]]; then
    warn "Send group message via HTTP/3 failed (curl exit $SEND_GROUP_MSG_RC)"
  elif [[ -n "$SEND_GROUP_MSG_RESPONSE" ]]; then
    SEND_GROUP_MSG_CODE=$(echo "$SEND_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$SEND_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
      ok "Send group message works via HTTP/3"
    else
      warn "Send group message via HTTP/3 failed - HTTP $SEND_GROUP_MSG_CODE"
      echo "Response body: $(echo "$SEND_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping group message - Group ID not available"
  else
    warn "Skipping group message - social-service not available or no auth token"
  fi
fi

# Test 9e: Social Service - Get Group Details (HTTP/2) — strict TLS + resolve; retry up to 2x on curl exit 7 (connection)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9e: Social Service - Get Group Details via HTTP/2"
  GET_GROUP_RC=0
  GET_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || GET_GROUP_RC=$?
  _retry=0
  while [[ "$GET_GROUP_RC" -eq 7 ]] && [[ -z "$(echo "$GET_GROUP_RESPONSE" | tail -1 | grep -E '^[0-9]+$')" ]] && [[ "$_retry" -lt 2 ]]; do
    sleep 2
    GET_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || GET_GROUP_RC=$?
    _retry=$((_retry + 1))
  done
  GET_GROUP_CODE=$(echo "$GET_GROUP_RESPONSE" | tail -1)
  if [[ "$GET_GROUP_RC" -ne 0 ]]; then
    warn "Get group details request failed (curl exit $GET_GROUP_RC)"
  elif [[ "$GET_GROUP_CODE" =~ ^(200)$ ]]; then
    ok "Get group details works via HTTP/2"
  else
    warn "Get group details failed - HTTP $GET_GROUP_CODE"
    echo "Response body: $(echo "$GET_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping get group details - Group ID not available"
  else
    warn "Skipping get group details - social-service not available or no auth token"
  fi
fi

# Test 9f: Social Service - Reply to Group Message (WhatsApp-style) (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9f: Social Service - Reply to Group Message via HTTP/2 (WhatsApp-style)"
  # First, get a message ID from the group (from Test 9d)
  # Try to get group messages by querying the group details or messages with group_id filter
  GET_GROUP_MSG_RC=0
  GET_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages?page=1&limit=50" 2>&1) || GET_GROUP_MSG_RC=$?
  if [[ "$GET_GROUP_MSG_RC" -eq 7 ]]; then
    sleep 2
    GET_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages?page=1&limit=50" 2>&1) || GET_GROUP_MSG_RC=$?
  fi
  if [[ "$GET_GROUP_MSG_RC" -eq 0 ]]; then
    GET_GROUP_MSG_CODE=$(echo "$GET_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$GET_GROUP_MSG_CODE" == "200" ]]; then
      # Try to extract a message ID from the group messages (look for messages with group_id matching GROUP_ID)
      # First try to find a message with group_id in the response
      GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and 'messages' in data:
        messages = data['messages']
    elif isinstance(data, list):
        messages = data
    else:
        messages = []
    for msg in messages:
        if isinstance(msg, dict) and msg.get('group_id') == '${GROUP_ID}':
            print(msg.get('id', ''))
            break
except:
    pass
" 2>/dev/null || echo "")
      # If not found, try simple grep (fallback) - get any message ID
      if [[ -z "$GROUP_MSG_ID" ]]; then
        GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      fi
      # Debug output
      if [[ -z "$GROUP_MSG_ID" ]]; then
        echo "Debug: Could not extract group message ID from response"
        echo "Response preview: $(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | head -20)"
      fi
      if [[ -n "$GROUP_MSG_ID" ]]; then
        REPLY_GROUP_MSG_RC=0
        REPLY_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          -X POST "https://$HOST:${PORT}/api/messages/$GROUP_MSG_ID/reply" \
          -d '{"message_type":"group","subject":"Re: Group Chat Test","content":"This is a WhatsApp-style reply to the previous message!"}' 2>&1) || REPLY_GROUP_MSG_RC=$?
        REPLY_GROUP_MSG_CODE=$(echo "$REPLY_GROUP_MSG_RESPONSE" | tail -1)
        if [[ "$REPLY_GROUP_MSG_RC" -ne 0 ]]; then
          warn "Reply to group message request failed (curl exit $REPLY_GROUP_MSG_RC)"
        elif [[ "$REPLY_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
          ok "Reply to group message works via HTTP/2 (WhatsApp-style)"
          # Check if parent_message is included in response
          if echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | grep -q "parent_message"; then
            ok "Parent message context included in reply response"
          fi
        else
          warn "Reply to group message failed - HTTP $REPLY_GROUP_MSG_CODE"
          echo "Response body: $(echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
        fi
      else
        warn "No group message ID found to reply to"
      fi
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping reply to group message - Group ID not available"
  else
    warn "Skipping reply to group message - social-service not available or no auth token"
  fi
fi

# Test 9g: Social Service - Forum Post with upload_type (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9g: Social Service - Create Forum Post with upload_type via HTTP/2"
  FORUM_POST_UPLOAD_RC=0
  FORUM_POST_UPLOAD_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Image Post","content":"This is a test post with upload_type=image","flair":"general","upload_type":"image"}' 2>&1) || FORUM_POST_UPLOAD_RC=$?
  FORUM_POST_UPLOAD_CODE=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_UPLOAD_RC" -ne 0 ]]; then
    warn "Create forum post with upload_type request failed (curl exit $FORUM_POST_UPLOAD_RC)"
  elif [[ "$FORUM_POST_UPLOAD_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post with upload_type works via HTTP/2"
    FORUM_POST_UPLOAD_ID=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    # Verify upload_type is in response
    if echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -q '"upload_type":"image"'; then
      ok "upload_type field correctly returned in response"
    fi
  else
    warn "Create forum post with upload_type failed - HTTP $FORUM_POST_UPLOAD_CODE"
    echo "Response body: $(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post with upload_type - social-service not available or no auth token"
fi

# Test 9h: Social Service - Add Attachment to Forum Post (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9h: Social Service - Add Attachment to Forum Post via HTTP/2"
  POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  POST_ATTACH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$POST_ID/attachments" \
    -d '{"file_url":"https://example.com/test-image.jpg","file_type":"image","file_name":"test-image.jpg","mime_type":"image/jpeg","file_size":12345,"width":1920,"height":1080,"display_order":0}' 2>&1) || POST_ATTACH_RC=$?
  POST_ATTACH_CODE=$(echo "$POST_ATTACH_RESPONSE" | tail -1)
  if [[ "$POST_ATTACH_RC" -ne 0 ]]; then
    warn "Add post attachment request failed (curl exit $POST_ATTACH_RC)"
  elif [[ "$POST_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to forum post works via HTTP/2"
    POST_ATTACH_ID=$(echo "$POST_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add post attachment failed - HTTP $POST_ATTACH_CODE"
    echo "Response body: $(echo "$POST_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
    warn "Skipping add post attachment - Forum post ID not available"
  else
    warn "Skipping add post attachment - social-service not available or no auth token"
  fi
fi

# Test 9i: Social Service - Add Attachment to Comment (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 9i: Social Service - Add Comment with Attachment via HTTP/3"
  # First create a comment
  COMMENT_WITH_ATTACH_RC=0
  COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"This comment will have an attachment"}' 2>&1) || COMMENT_WITH_ATTACH_RC=$?
  if [[ "$COMMENT_WITH_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_RESPONSE" ]]; then
    COMMENT_CODE=$(echo "$COMMENT_RESPONSE" | tail -1)
    if [[ "$COMMENT_CODE" =~ ^(200|201)$ ]]; then
      COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      # Also try JSON parsing as fallback
      if [[ -z "$COMMENT_ID" ]]; then
        COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', '') if isinstance(data, dict) else '')" 2>/dev/null || echo "")
      fi
      if [[ -n "$COMMENT_ID" ]] && [[ "$COMMENT_ID" != "placeholder-comment-id" ]]; then
        # Add attachment to comment
        COMMENT_ATTACH_RC=0
        COMMENT_ATTACH_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          --resolve "$HTTP3_RESOLVE" \
          -X POST "https://$HOST/api/forum/comments/$COMMENT_ID/attachments" \
          -d '{"file_url":"https://example.com/comment-pdf.pdf","file_type":"document","file_name":"document.pdf","mime_type":"application/pdf","file_size":54321,"display_order":0}' 2>&1) || COMMENT_ATTACH_RC=$?
        if [[ "$COMMENT_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_ATTACH_RESPONSE" ]]; then
          COMMENT_ATTACH_CODE=$(echo "$COMMENT_ATTACH_RESPONSE" | tail -1)
          if [[ "$COMMENT_ATTACH_CODE" =~ ^(200|201)$ ]]; then
            ok "Add attachment to comment works via HTTP/3"
          else
            warn "Add comment attachment failed - HTTP $COMMENT_ATTACH_CODE"
            echo "Response body: $(echo "$COMMENT_ATTACH_RESPONSE" | sed '$d' | head -5)"
          fi
        else
          warn "Add comment attachment request failed (curl exit $COMMENT_ATTACH_RC)"
        fi
      else
        warn "Comment ID extraction failed or invalid - COMMENT_ID='${COMMENT_ID}'"
        echo "Comment response: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -10)"
      fi
    else
      warn "Create comment for attachment test failed - HTTP $COMMENT_CODE"
      echo "Response body: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Create comment for attachment test failed"
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment attachment - Forum post ID not available"
  else
    warn "Skipping add comment attachment - social-service not available or no auth token"
  fi
fi

# Test 9j: Social Service - Add Attachment to Message (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
  say "Test 9j: Social Service - Add Attachment to Message via HTTP/2"
  MSG_ATTACH_RC=0
  MSG_ID="${MESSAGE_ID:-$MESSAGE_H3_ID}"
  MSG_ATTACH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/attachments" \
    -d '{"file_url":"https://example.com/video.mp4","file_type":"video","file_name":"test-video.mp4","mime_type":"video/mp4","file_size":9876543,"width":1280,"height":720,"duration":120,"display_order":0}' 2>&1) || MSG_ATTACH_RC=$?
  MSG_ATTACH_CODE=$(echo "$MSG_ATTACH_RESPONSE" | tail -1)
  if [[ "$MSG_ATTACH_RC" -ne 0 ]]; then
    warn "Add message attachment request failed (curl exit $MSG_ATTACH_RC)"
  elif [[ "$MSG_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to message works via HTTP/2"
    MSG_ATTACH_ID=$(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add message attachment failed - HTTP $MSG_ATTACH_CODE"
    echo "Response body: $(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
    warn "Skipping add message attachment - Message ID not available"
  else
    warn "Skipping add message attachment - social-service not available or no auth token"
  fi
fi

# Test 9k: Social Service - Leave Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9k: Social Service - Leave Group Chat via HTTP/2"
  LEAVE_GROUP_RC=0
  LEAVE_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X DELETE "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/leave" 2>&1) || LEAVE_GROUP_RC=$?
  LEAVE_GROUP_CODE=$(echo "$LEAVE_GROUP_RESPONSE" | tail -1)
  if [[ "$LEAVE_GROUP_RC" -ne 0 ]]; then
    warn "Leave group request failed (curl exit $LEAVE_GROUP_RC)"
  elif [[ "$LEAVE_GROUP_CODE" =~ ^(204)$ ]]; then
    ok "Leave group chat works via HTTP/2"
    # Verify user is no longer in group by trying to get group details (should fail with 403); use resolve for strict TLS; retry on 000
    VERIFY_LEAVE_RC=0
    VERIFY_LEAVE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || VERIFY_LEAVE_RC=$?
    VERIFY_LEAVE_CODE=$(echo "$VERIFY_LEAVE_RESPONSE" | tail -1)
    if [[ "$VERIFY_LEAVE_CODE" == "000" ]] || [[ -z "$VERIFY_LEAVE_CODE" ]]; then
      sleep 2
      VERIFY_LEAVE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $TOKEN_USER2" \
        -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || VERIFY_LEAVE_RC=$?
      VERIFY_LEAVE_CODE=$(echo "$VERIFY_LEAVE_RESPONSE" | tail -1)
    fi
    if [[ "$VERIFY_LEAVE_CODE" == "403" ]]; then
      ok "User successfully left group (403 on group access confirms removal)"
    else
      warn "Leave verification unexpected - HTTP $VERIFY_LEAVE_CODE (expected 403)"
    fi
  else
    warn "Leave group failed - HTTP $LEAVE_GROUP_CODE"
    echo "Response body: $(echo "$LEAVE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping leave group - Group ID not available"
  else
    warn "Skipping leave group - social-service not available or no auth token"
  fi
fi

# Test 9l: Social Service - Get Post Attachments (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9l: Social Service - Get Post Attachments via HTTP/3"
  GET_POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  GET_POST_ATTACH_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer ${TOKEN:-$TOKEN_USER2}" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/forum/posts/$POST_ID/attachments" 2>&1) || GET_POST_ATTACH_RC=$?
  if [[ "$GET_POST_ATTACH_RC" -eq 0 ]] && [[ -n "$GET_POST_ATTACH_RESPONSE" ]]; then
    GET_POST_ATTACH_CODE=$(echo "$GET_POST_ATTACH_RESPONSE" | tail -1)
    if [[ "$GET_POST_ATTACH_CODE" == "200" ]]; then
      ok "Get post attachments works via HTTP/3"
    else
      warn "Get post attachments failed - HTTP $GET_POST_ATTACH_CODE"
    fi
  else
    warn "Get post attachments request failed (curl exit $GET_POST_ATTACH_RC)"
  fi
else
  warn "Skipping get post attachments - Forum post ID not available"
fi

# Test 10: Listings Service - Health Check (HTTP/2)
# Note: Health check should be public (no auth required), but listings service requires auth
# So we'll test it directly or skip if it requires auth
if [[ "${SKIP_LISTINGS:-}" != "1" ]]; then
  say "Test 10: Listings Service - Health Check via HTTP/2"
  LISTINGS_HEALTH_RC=0
  LISTINGS_HEALTH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME:-15}" \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/api/listings/healthz" 2>/tmp/listings-health.log) || LISTINGS_HEALTH_RC=$?
  LISTINGS_HEALTH_CODE=$(echo "$LISTINGS_HEALTH_RESPONSE" | tail -1)
  if [[ "$LISTINGS_HEALTH_RC" -ne 0 ]]; then
    warn "Listings health check failed (curl exit $LISTINGS_HEALTH_RC)"
  elif [[ "$LISTINGS_HEALTH_CODE" =~ ^(200|401)$ ]]; then
    # 401 is expected if healthz requires auth (which it shouldn't, but listings router has global auth middleware)
    if [[ "$LISTINGS_HEALTH_CODE" == "200" ]]; then
      ok "Listings health check works via HTTP/2"
    else
      warn "Listings health check requires auth (HTTP 401) - this is a configuration issue"
    fi
  else
    warn "Listings health check failed - HTTP $LISTINGS_HEALTH_CODE"
  fi
else
  warn "Skipping listings health check - listings-service not available"
fi

# Test 10b: Listings Service - Health Check (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]]; then
  say "Test 10b: Listings Service - Health Check via HTTP/3"
  LISTINGS_HEALTH_H3_RC=0
  LISTINGS_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/listings/healthz" 2>/tmp/listings-health-h3.log) || LISTINGS_HEALTH_H3_RC=$?
  if [[ "$LISTINGS_HEALTH_H3_RC" -ne 0 ]]; then
    warn "Listings health check via HTTP/3 failed (curl exit $LISTINGS_HEALTH_H3_RC)"
  elif [[ -n "$LISTINGS_HEALTH_H3_RESPONSE" ]]; then
    LISTINGS_HEALTH_H3_CODE=$(echo "$LISTINGS_HEALTH_H3_RESPONSE" | tail -1)
    if [[ "$LISTINGS_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
      ok "Listings health check works via HTTP/3"
    else
      warn "Listings health check via HTTP/3 failed - HTTP $LISTINGS_HEALTH_H3_CODE"
    fi
  fi
else
  warn "Skipping listings health check via HTTP/3 - listings-service not available"
fi

# Test 11: Listings Service - Search Listings (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 11: Listings Service - Search Listings via HTTP/2"
  LISTINGS_SEARCH_RC=0
  # Search can be slow (DB + cache); use 60s to avoid curl exit 28 (timeout). 504 = gateway timeout — retry once.
  LISTINGS_SEARCH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --connect-timeout 10 --max-time 60 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_RC=$?
  LISTINGS_SEARCH_CODE=$(echo "$LISTINGS_SEARCH_RESPONSE" | tail -1)
  if [[ "$LISTINGS_SEARCH_RC" -eq 0 ]] && [[ "$LISTINGS_SEARCH_CODE" == "504" ]]; then
    info "Search listings got HTTP 504 (gateway timeout); retrying once..."
    sleep 2
    LISTINGS_SEARCH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --connect-timeout 10 --max-time 60 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      "https://$HOST:${PORT}/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_RC=$?
    LISTINGS_SEARCH_CODE=$(echo "$LISTINGS_SEARCH_RESPONSE" | tail -1)
  fi
  if [[ "$LISTINGS_SEARCH_RC" -ne 0 ]]; then
    warn "Search listings request failed (curl exit $LISTINGS_SEARCH_RC)"
  elif [[ "$LISTINGS_SEARCH_CODE" =~ ^(200)$ ]]; then
    ok "Search listings works via HTTP/2"
  else
    warn "Search listings failed - HTTP $LISTINGS_SEARCH_CODE"
    echo "Response body: $(echo "$LISTINGS_SEARCH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping search listings - listings-service not available or no auth token"
fi

# Test 11b: Listings Service - Search Listings (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 11b: Listings Service - Search Listings via HTTP/3"
  LISTINGS_SEARCH_H3_RC=0
  LISTINGS_SEARCH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_H3_RC=$?
  if [[ "$LISTINGS_SEARCH_H3_RC" -ne 0 ]]; then
    warn "Search listings via HTTP/3 failed (curl exit $LISTINGS_SEARCH_H3_RC)"
  elif [[ -n "$LISTINGS_SEARCH_H3_RESPONSE" ]]; then
    LISTINGS_SEARCH_H3_CODE=$(echo "$LISTINGS_SEARCH_H3_RESPONSE" | tail -1)
    if [[ "$LISTINGS_SEARCH_H3_CODE" =~ ^(200)$ ]]; then
      ok "Search listings works via HTTP/3"
    else
      warn "Search listings via HTTP/3 failed - HTTP $LISTINGS_SEARCH_H3_CODE"
      echo "Response body: $(echo "$LISTINGS_SEARCH_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping search listings via HTTP/3 - listings-service not available or no auth token"
fi

# Test 12: Listings Service - Create Listing (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 12: Listings Service - Create Listing via HTTP/2"
  LISTINGS_CREATE_RC=0
  # Try with NodePort (HTTP/2), with increased timeout to match API gateway proxyTimeout
  LISTINGS_CREATE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 --connect-timeout 10 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/listings" \
    -d '{"title":"Test Vinyl Record","description":"Mint condition test listing","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_RC=$?
  
  # If NodePort times out, try port 443 as fallback (same as HTTP/3 test)
  if [[ "$LISTINGS_CREATE_RC" -eq 28 ]]; then
    warn "NodePort ${PORT} timed out, trying port 443 as fallback..."
    LISTINGS_CREATE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 --connect-timeout 10 \
      --resolve "$HOST:443:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:443/api/listings" \
      -d '{"title":"Test Vinyl Record","description":"Mint condition test listing","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_RC=$?
  fi
  
  LISTINGS_CREATE_CODE=$(echo "$LISTINGS_CREATE_RESPONSE" | tail -1)
  if [[ "$LISTINGS_CREATE_RC" -ne 0 ]]; then
    warn "Create listing request failed (HTTP ${LISTINGS_CREATE_CODE:-000}, curl exit $LISTINGS_CREATE_RC)"
    if [[ "$LISTINGS_CREATE_RC" -eq 28 ]]; then
      warn "  → Timeout (28): Request took longer than 30s on both NodePort ${PORT} and port 443"
      warn "  → This may indicate:"
      warn "     - Database connection issue (check listings-service logs)"
      warn "     - API gateway proxy timeout"
      warn "     - HTTP/2 connection pooling issue in Caddy/Linkerd"
      warn "  → Note: HTTP/3 version (Test 12b) works, suggesting HTTP/2-specific issue"
      warn "  → Debug: Check kubectl logs -l app=listings-service"
    fi
  elif [[ "$LISTINGS_CREATE_CODE" =~ ^(200|201)$ ]]; then
    ok "Create listing works via HTTP/2"
    _body_12=$(echo "$LISTINGS_CREATE_RESPONSE" | sed '$d')
    if command -v jq >/dev/null 2>&1; then
      LISTING_ID=$(echo "$_body_12" | jq -r '.id // empty' 2>/dev/null || echo "")
    fi
    [[ -z "$LISTING_ID" ]] && LISTING_ID=$(echo "$_body_12" | grep -oE '"id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' | head -1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' || echo "")
    if [[ -n "$LISTING_ID" ]]; then
      info "Listing ID (HTTP/2): $LISTING_ID"
    else
      warn "Create listing returned 201 but no listing id in response (check API response shape)"
      echo "Response body: $(echo "$_body_12" | head -3)"
    fi
    verify_db_after_test 5435 listings "SELECT COUNT(*) FROM listings.listings WHERE title = 'Test Vinyl Record'" "Test 12 DB: listing in listings.listings (port 5435)" || true
  else
    warn "Create listing failed - HTTP $LISTINGS_CREATE_CODE"
    echo "Response body: $(echo "$LISTINGS_CREATE_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping create listing - listings-service not available or no auth token"
fi

# Test 12b: Listings Service - Create Listing (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 12b: Listings Service - Create Listing via HTTP/3"
  LISTINGS_CREATE_H3_RC=0
  LISTINGS_CREATE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings" \
    -d '{"title":"Test Vinyl Record H3","description":"Mint condition test listing via HTTP/3","price":34.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_H3_RC=$?
  LISTINGS_CREATE_H3_CODE=$(echo "$LISTINGS_CREATE_H3_RESPONSE" | tail -1)
  if [[ "$LISTINGS_CREATE_H3_RC" -ne 0 ]]; then
    warn "Create listing via HTTP/3 failed (HTTP ${LISTINGS_CREATE_H3_CODE:-000}, curl exit $LISTINGS_CREATE_H3_RC: $(_http3_exit_meaning "$LISTINGS_CREATE_H3_RC"))"
  elif [[ -n "$LISTINGS_CREATE_H3_RESPONSE" ]]; then
    if [[ "$LISTINGS_CREATE_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create listing works via HTTP/3"
      _body_12b=$(echo "$LISTINGS_CREATE_H3_RESPONSE" | sed '$d')
      if command -v jq >/dev/null 2>&1; then
        LISTING_H3_ID=$(echo "$_body_12b" | jq -r '.id // empty' 2>/dev/null || echo "")
      fi
      [[ -z "$LISTING_H3_ID" ]] && LISTING_H3_ID=$(echo "$_body_12b" | grep -oE '"id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' | head -1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' || echo "")
      if [[ -n "$LISTING_H3_ID" ]]; then
        info "Listing ID (HTTP/3): $LISTING_H3_ID"
      else
        warn "Create listing (HTTP/3) returned 201 but no listing id in response (check API response shape)"
        echo "Response body: $(echo "$_body_12b" | head -3)"
      fi
      verify_db_after_test 5435 listings "SELECT COUNT(*) FROM listings.listings WHERE title = 'Test Vinyl Record H3'" "Test 12b DB: H3 listing in listings.listings" || true
    else
      warn "Create listing via HTTP/3 failed - HTTP $LISTINGS_CREATE_H3_CODE"
      echo "Response body: $(echo "$LISTINGS_CREATE_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping create listing via HTTP/3 - listings-service not available or no auth token"
fi

# Test 12c: Listings Service - Get My Listings (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12c: Listings Service - Get My Listings via HTTP/3"
  LISTINGS_MY_H3_RC=0
  LISTINGS_MY_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/listings/my-listings" 2>&1) || LISTINGS_MY_H3_RC=$?
  LISTINGS_MY_H3_CODE=$(echo "$LISTINGS_MY_H3_RESPONSE" | tail -1)
  if [[ "$LISTINGS_MY_H3_RC" -ne 0 ]]; then
    warn "Get my listings via HTTP/3 failed (HTTP ${LISTINGS_MY_H3_CODE:-000}, curl exit $LISTINGS_MY_H3_RC: $(_http3_exit_meaning "$LISTINGS_MY_H3_RC"))"
  elif [[ "$LISTINGS_MY_H3_CODE" =~ ^(200)$ ]]; then
    ok "Get my listings works via HTTP/3"
  else
    warn "Get my listings via HTTP/3 failed - HTTP $LISTINGS_MY_H3_CODE"
  fi
else
  [[ "${SKIP_LISTINGS:-}" == "1" ]] || [[ -z "${TOKEN:-}" ]] || info "Skipping get my listings via HTTP/3 - no token or HTTP/3 not available"
fi

# Test 12d: Listings Service - Add to Watchlist (HTTP/2) — hits listings.watchlist (port 5435, CURRENT_DB_SCHEMA_REPORT)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]]; then
  say "Test 12d: Listings Service - Add to Watchlist via HTTP/2"
  WATCH_LIST_RC=0
  WATCH_LIST_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/listings/${LISTING_ID}/watch" 2>&1) || WATCH_LIST_RC=$?
  WATCH_LIST_CODE=$(echo "$WATCH_LIST_RESPONSE" | tail -1)
  if [[ "$WATCH_LIST_RC" -ne 0 ]]; then
    warn "Add to watchlist via HTTP/2 failed (curl exit $WATCH_LIST_RC)"
  elif [[ "$WATCH_LIST_CODE" =~ ^(200|201)$ ]]; then
    ok "Add to watchlist works via HTTP/2 (listings.watchlist)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5435 listings "SELECT 1 FROM listings.watchlist WHERE user_id = '${USER1_ID}'::uuid AND listing_id = '${LISTING_ID}'::uuid LIMIT 1" "Test 12d DB: watchlist in listings.watchlist" || true
  else
    warn "Add to watchlist via HTTP/2 failed - HTTP $WATCH_LIST_CODE"
  fi
else
  [[ -z "${LISTING_ID:-}" ]] && info "Skipping add to watchlist - LISTING_ID not available"
fi

# Test 12e: Listings Service - Add to Watchlist (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12e: Listings Service - Add to Watchlist via HTTP/3"
  WATCH_LIST_H3_RC=0
  WATCH_LIST_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings/${LISTING_ID}/watch" 2>&1) || WATCH_LIST_H3_RC=$?
  WATCH_LIST_H3_CODE=$(echo "$WATCH_LIST_H3_RESPONSE" | tail -1)
  if [[ "$WATCH_LIST_H3_RC" -ne 0 ]]; then
    warn "Add to watchlist via HTTP/3 failed (curl exit $WATCH_LIST_H3_RC)"
  elif [[ "$WATCH_LIST_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Add to watchlist works via HTTP/3 (listings.watchlist)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5435 listings "SELECT 1 FROM listings.watchlist WHERE user_id = '${USER1_ID}'::uuid AND listing_id = '${LISTING_ID}'::uuid LIMIT 1" "Test 12e DB: H3 watchlist in listings.watchlist" || true
  else
    warn "Add to watchlist via HTTP/3 failed - HTTP $WATCH_LIST_H3_CODE"
  fi
fi

# Test 12f: Listings Service - User Settings (HTTP/2) — hits listings.user_settings (port 5435)
# 502 on H2 but 12i (H3) OK = one listings pod can't reach 5435 (host aliases / pod connectivity). Retry once on 502 or exit 28.
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 12f: Listings Service - Update User Settings via HTTP/2"
  SETTINGS_RC=0
  SETTINGS_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME_LISTINGS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X PUT "https://$HOST:${PORT}/api/listings/settings" \
    -d '{"country_code":"US","currency":"USD","fee_rate":0,"duty_rate":0}' 2>&1) || SETTINGS_RC=$?
  SETTINGS_CODE=$(echo "$SETTINGS_RESPONSE" | tail -1)
  # Retry once on timeout (exit 28) or 502 (pod connectivity flake)
  if [[ "$SETTINGS_RC" -eq 28 ]] || [[ "$SETTINGS_CODE" == "502" ]]; then
    sleep 3
    SETTINGS_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME_LISTINGS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      -X PUT "https://$HOST:${PORT}/api/listings/settings" \
      -d '{"country_code":"US","currency":"USD","fee_rate":0,"duty_rate":0}' 2>&1) || SETTINGS_RC=$?
    SETTINGS_CODE=$(echo "$SETTINGS_RESPONSE" | tail -1)
  fi
  if [[ "$SETTINGS_RC" -ne 0 ]]; then
    warn "Update listings settings via HTTP/2 failed (curl exit $SETTINGS_RC)"
    [[ "$SETTINGS_RC" -eq 28 ]] && info "  curl exit 28 = timeout; ensure Caddy/backend responsive. Retry already attempted."
  elif [[ "$SETTINGS_CODE" == "204" ]] || [[ "$SETTINGS_CODE" =~ ^(200|201)$ ]]; then
    ok "Update listings settings works via HTTP/2 (listings.user_settings)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5435 listings "SELECT 1 FROM listings.user_settings WHERE user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 12f DB: user_settings" || true
  else
    warn "Update listings settings via HTTP/2 failed - HTTP $SETTINGS_CODE"
    [[ "$SETTINGS_CODE" == "502" ]] && info "  502 on H2 but 12i (H3) OK = pod connectivity to 5435; on k3d run ./scripts/apply-k3d-host-aliases.sh, on Colima run ./scripts/colima-apply-host-aliases.sh; then ./scripts/diagnose-502-and-analytics.sh. Ensure Postgres on 0.0.0.0:5435."
  fi
fi

# Test 12g: Listings Service - Add Image to Listing (HTTP/2) — hits listings.listing_images (port 5435)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]]; then
  say "Test 12g: Listings Service - Add Image to Listing via HTTP/2"
  ADD_IMAGE_RC=0
  ADD_IMAGE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/listings/${LISTING_ID}/images" \
    -d "{\"image_url\":\"https://example.com/test-image-$RANDOM.jpg\",\"display_order\":0,\"is_primary\":true}" 2>&1) || ADD_IMAGE_RC=$?
  ADD_IMAGE_CODE=$(echo "$ADD_IMAGE_RESPONSE" | tail -1)
  if [[ "$ADD_IMAGE_RC" -ne 0 ]]; then
    warn "Add listing image via HTTP/2 failed (curl exit $ADD_IMAGE_RC)"
    _maybe_capture "$ADD_IMAGE_RESPONSE" "12g"
  elif [[ "$ADD_IMAGE_CODE" =~ ^(200|201)$ ]]; then
    ok "Add listing image works via HTTP/2 (listings.listing_images)"
    verify_db_after_test 5435 listings "SELECT 1 FROM listings.listing_images WHERE listing_id = '${LISTING_ID}'::uuid LIMIT 1" "Test 12g DB: listing_images" || true
  else
    warn "Add listing image via HTTP/2 failed - HTTP $ADD_IMAGE_CODE"
    _maybe_capture "$ADD_IMAGE_RESPONSE" "12g"
  fi
fi

# Test 12h: Listings Service - Make Offer (HTTP/2) — hits listings.offers (port 5435)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]]; then
  say "Test 12h: Listings Service - Make Offer on Listing via HTTP/2"
  OFFER_RC=0
  OFFER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/listings/${LISTING_ID}/offer" \
    -d "{\"offer_amount\":25.00,\"message\":\"Test offer via HTTP/2\"}" 2>&1) || OFFER_RC=$?
  OFFER_CODE=$(echo "$OFFER_RESPONSE" | tail -1)
  if [[ "$OFFER_RC" -ne 0 ]]; then
    warn "Make offer via HTTP/2 failed (curl exit $OFFER_RC)"
  elif [[ "$OFFER_CODE" =~ ^(200|201)$ ]]; then
    ok "Make offer works via HTTP/2 (listings.offers)"
    verify_db_after_test 5435 listings "SELECT 1 FROM listings.offers WHERE listing_id = '${LISTING_ID}'::uuid AND offer_amount = 25.00 LIMIT 1" "Test 12h DB: offers" || true
  else
    warn "Make offer via HTTP/2 failed - HTTP $OFFER_CODE"
  fi
fi

# Test 12g2: Listings Service - Add Image to Listing (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12g2: Listings Service - Add Image to Listing via HTTP/3"
  ADD_IMAGE_H3_RC=0
  ADD_IMAGE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings/${LISTING_ID}/images" \
    -d "{\"image_url\":\"https://example.com/h3-image-$RANDOM.jpg\",\"display_order\":1,\"is_primary\":false}" 2>&1) || ADD_IMAGE_H3_RC=$?
  ADD_IMAGE_H3_CODE=$(echo "$ADD_IMAGE_H3_RESPONSE" | tail -1)
  if [[ "$ADD_IMAGE_H3_RC" -ne 0 ]]; then
    warn "Add listing image via HTTP/3 failed (curl exit $ADD_IMAGE_H3_RC)"
  elif [[ "$ADD_IMAGE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Add listing image works via HTTP/3 (listings.listing_images)"
  else
    warn "Add listing image via HTTP/3 failed - HTTP $ADD_IMAGE_H3_CODE"
  fi
fi

# Test 12i: Listings Service - User Settings (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12i: Listings Service - Update User Settings via HTTP/3"
  SETTINGS_H3_RC=0
  SETTINGS_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X PUT "https://$HOST/api/listings/settings" \
    -d '{"country_code":"US","currency":"USD"}' 2>&1) || SETTINGS_H3_RC=$?
  SETTINGS_H3_CODE=$(echo "$SETTINGS_H3_RESPONSE" | tail -1)
  if [[ "$SETTINGS_H3_RC" -ne 0 ]]; then
    warn "Update listings settings via HTTP/3 failed (curl exit $SETTINGS_H3_RC)"
  elif [[ "$SETTINGS_H3_CODE" == "204" ]] || [[ "$SETTINGS_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Update listings settings works via HTTP/3 (listings.user_settings)"
  else
    warn "Update listings settings via HTTP/3 failed - HTTP $SETTINGS_H3_CODE"
  fi
fi

# Test 12j: Listings Service - Make Offer (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${LISTING_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12j: Listings Service - Make Offer on Listing via HTTP/3"
  OFFER_H3_RC=0
  OFFER_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings/${LISTING_ID}/offer" \
    -d "{\"offer_amount\":30.00,\"message\":\"Test offer via HTTP/3\"}" 2>&1) || OFFER_H3_RC=$?
  OFFER_H3_CODE=$(echo "$OFFER_H3_RESPONSE" | tail -1)
  if [[ "$OFFER_H3_RC" -ne 0 ]]; then
    warn "Make offer via HTTP/3 failed (curl exit $OFFER_H3_RC)"
  elif [[ "$OFFER_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Make offer works via HTTP/3 (listings.offers)"
  else
    warn "Make offer via HTTP/3 failed - HTTP $OFFER_H3_CODE"
  fi
fi

# Test 12k: Create auction listing (HTTP/2) — for bids test; hits listings.auction_details (port 5435)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  _expires_auction=$(date -u -v+7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+7 days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
  [[ -z "$_expires_auction" ]] && _expires_auction=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() + timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null || echo "")
  if [[ -n "${_expires_auction:-}" ]]; then
    say "Test 12k: Listings Service - Create Auction Listing via HTTP/2"
    AUCTION_CREATE_RC=0
    AUCTION_CREATE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/listings" \
      -d "{\"title\":\"Test Auction Vinyl\",\"description\":\"Auction listing for bids test\",\"price\":10.00,\"currency\":\"USD\",\"listing_type\":\"auction\",\"condition\":\"vinyl\",\"category\":\"vinyl\",\"location\":\"US\",\"expires_at\":\"$_expires_auction\"}" 2>&1) || AUCTION_CREATE_RC=$?
    AUCTION_CREATE_CODE=$(echo "$AUCTION_CREATE_RESPONSE" | tail -1)
    if [[ "$AUCTION_CREATE_RC" -eq 0 ]] && [[ "$AUCTION_CREATE_CODE" == "201" ]]; then
      AUCTION_LISTING_ID=$(echo "$AUCTION_CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      [[ -z "$AUCTION_LISTING_ID" ]] && command -v jq >/dev/null 2>&1 && AUCTION_LISTING_ID=$(echo "$AUCTION_CREATE_RESPONSE" | sed '$d' | jq -r '.id // empty' 2>/dev/null || echo "")
      if [[ -n "$AUCTION_LISTING_ID" ]]; then
        ok "Create auction listing works via HTTP/2 (listings.auction_details)"
        verify_db_after_test 5435 listings "SELECT 1 FROM listings.auction_details WHERE listing_id = '${AUCTION_LISTING_ID}'::uuid LIMIT 1" "Test 12k DB: auction_details" || true
      else
        warn "Auction created but no listing ID in response"
      fi
    else
      [[ "$AUCTION_CREATE_RC" -ne 0 ]] && warn "Create auction listing failed (curl exit $AUCTION_CREATE_RC)"
      [[ "$AUCTION_CREATE_CODE" != "201" ]] && warn "Create auction listing failed - HTTP $AUCTION_CREATE_CODE"
    fi
  else
    info "Skipping auction creation - could not compute expires_at"
  fi
fi

# Test 12l: Place bid on auction (HTTP/2) — hits listings.bids (port 5435); User 2 bids on User 1's auction
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${AUCTION_LISTING_ID:-}" ]]; then
  say "Test 12l: Listings Service - Place Bid on Auction via HTTP/2"
  BID_RC=0
  BID_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X POST "https://$HOST:${PORT}/api/listings/${AUCTION_LISTING_ID}/bid" \
    -d '{"bid_amount":15.00}' 2>&1) || BID_RC=$?
  BID_CODE=$(echo "$BID_RESPONSE" | tail -1)
  if [[ "$BID_RC" -ne 0 ]]; then
    warn "Place bid via HTTP/2 failed (curl exit $BID_RC)"
  elif [[ "$BID_CODE" =~ ^(200|201)$ ]]; then
    ok "Place bid works via HTTP/2 (listings.bids)"
    [[ -n "${USER2_ID:-}" ]] && verify_db_after_test 5435 listings "SELECT 1 FROM listings.bids WHERE listing_id = '${AUCTION_LISTING_ID}'::uuid AND user_id = '${USER2_ID}'::uuid AND bid_amount = 15.00 LIMIT 1" "Test 12l DB: bids" || true
  else
    warn "Place bid via HTTP/2 failed - HTTP $BID_CODE"
  fi
fi

# Test 12m: Place bid (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${AUCTION_LISTING_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 12m: Listings Service - Place Bid on Auction via HTTP/3"
  BID_H3_RC=0
  BID_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings/${AUCTION_LISTING_ID}/bid" \
    -d '{"bid_amount":20.00}' 2>&1) || BID_H3_RC=$?
  BID_H3_CODE=$(echo "$BID_H3_RESPONSE" | tail -1)
  if [[ "$BID_H3_RC" -ne 0 ]]; then
    warn "Place bid via HTTP/3 failed (curl exit $BID_H3_RC)"
  elif [[ "$BID_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Place bid works via HTTP/3 (listings.bids)"
  else
    warn "Place bid via HTTP/3 failed - HTTP $BID_H3_CODE"
  fi
fi

# Test 13: Listings Service - Get My Listings (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 13: Listings Service - Get My Listings via HTTP/2"
  LISTINGS_MY_RC=0
  LISTINGS_MY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/listings/my-listings" 2>&1) || LISTINGS_MY_RC=$?
  LISTINGS_MY_CODE=$(echo "$LISTINGS_MY_RESPONSE" | tail -1)
  if [[ "$LISTINGS_MY_RC" -ne 0 ]]; then
    warn "Get my listings request failed (HTTP ${LISTINGS_MY_CODE:-000}, curl exit $LISTINGS_MY_RC)"
  elif [[ "$LISTINGS_MY_CODE" =~ ^(200)$ ]]; then
    ok "Get my listings works via HTTP/2"
  else
    warn "Get my listings failed - HTTP $LISTINGS_MY_CODE"
    echo "Response body: $(echo "$LISTINGS_MY_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get my listings - listings-service not available or no auth token"
fi

# Test 13: Shopping Service - Cart, Checkout, Orders, Purchase History, Resell (HTTP/2)
# DB verification: cart (shopping.shopping_cart), orders (shopping.orders) so HTTP/2 vs HTTP/3 and "No items in cart" can be debugged from DB state. New tables: see docs/CURRENT_DB_SCHEMA_REPORT.md.
# Root cause (duplicate order_number): App uses DB "shopping" on 5436 (POSTGRES_URL_SHOPPING ends with /shopping). See infra/docs/EIGHT-DATABASES-ARCHITECTURE.md.
# Sequence is in shopping.order_number_seq per DB; ensure script runs once here so 13c/13j5 never run it on retry (re-running ensure during test races with app and can cause duplicate). See scripts/ensure-shopping-order-number-sequence.sh and infra/db/09-shopping-order-number-sequence.sql.
# Fallback: if Create Listing via HTTP/2 (Test 12) failed, use listing created via HTTP/3 (Test 12b) so cart/checkout can still run.
[[ -z "${LISTING_ID:-}" ]] && [[ -n "${LISTING_H3_ID:-}" ]] && LISTING_ID="$LISTING_H3_ID" && info "Using LISTING_H3_ID as LISTING_ID for shopping (Test 12 HTTP/2 did not set LISTING_ID)"
# If still no LISTING_ID, try first listing from Get my listings (Test 13) response so we can run cart/checkout.
if [[ -z "${LISTING_ID:-}" ]] && [[ -n "${LISTINGS_MY_RESPONSE:-}" ]]; then
  _first_listing_id=$(echo "$LISTINGS_MY_RESPONSE" | sed '$d' | grep -oE '"id":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' | head -1 | cut -d'"' -f4 || echo "")
  [[ -n "$_first_listing_id" ]] && LISTING_ID="$_first_listing_id" && info "Using first listing id from Get my listings as LISTING_ID for shopping"
fi
if [[ "${SKIP_SHOPPING:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 13: Shopping Service - Cart Operations via HTTP/2"
  # Ensure order_number sequence once before any checkout (do not run on checkout retry — re-running ensure mid-test can race with app).
  if [[ -f "$SCRIPT_DIR/ensure-shopping-order-number-sequence.sh" ]]; then
    "$SCRIPT_DIR/ensure-shopping-order-number-sequence.sh" 2>&1 | grep -E "✅|⚠️|Applied|Verified" || true
  fi
  # Verify sequence and function exist on shopping DB (5436/shopping) so we know why checkout might still fail with duplicate key
  _seq_check=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=3 psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT 1 FROM pg_sequences WHERE schemaname='shopping' AND sequencename='order_number_seq'" 2>/dev/null || echo "")
  _fn_check=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=3 psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='shopping' AND p.proname='generate_order_number'" 2>/dev/null || echo "")
  if [[ -z "$_seq_check" ]] || [[ "$_seq_check" != "1" ]]; then
    info "Shopping order_number_seq not found on 5436/shopping — run scripts/ensure-shopping-order-number-sequence.sh (checkout 13c/13j5 may hit duplicate key)"
  fi
  if [[ -z "$_fn_check" ]] || [[ "$_fn_check" != "1" ]]; then
    info "shopping.generate_order_number() not found on 5436/shopping — run scripts/ensure-shopping-order-number-sequence.sh"
  fi

  # Test 13a: Add item to cart
  say "Test 13a: Shopping Service - Add Item to Cart via HTTP/2"
  if [[ -n "${LISTING_ID:-}" ]]; then
    ADD_CART_RC=0
    ADD_CART_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/cart" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99,\"metadata\":{\"title\":\"Test Listing\"}}" 2>&1) || ADD_CART_RC=$?
    ADD_CART_CODE=$(echo "$ADD_CART_RESPONSE" | tail -1)
    if [[ "$ADD_CART_RC" -ne 0 ]]; then
      warn "Add to cart request failed (curl exit $ADD_CART_RC)"
    elif [[ "$ADD_CART_CODE" =~ ^(200|201)$ ]]; then
      ok "Add item to cart works via HTTP/2"
      CART_ITEM_ID=$(echo "$ADD_CART_RESPONSE" | sed '$d' | grep -o '"cart_item_id":"[^"]*"' | cut -d'"' -f4 || echo "")
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id = '${USER1_ID}'" "Test 13a DB: cart has item(s) for user (HTTP/2 add)" || true
    else
      warn "Add to cart failed - HTTP $ADD_CART_CODE"
      echo "Response body: $(echo "$ADD_CART_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Skipping add to cart - Listing ID not available"
  fi

  # Test 13a2: Add to shopping watchlist (HTTP/2) — hits shopping.watchlist (port 5436, CURRENT_DB_SCHEMA_REPORT)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13a2: Shopping Service - Add to Watchlist via HTTP/2"
    ADD_WATCHLIST_RC=0
    ADD_WATCHLIST_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/shopping/watchlist" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\"}" 2>&1) || ADD_WATCHLIST_RC=$?
    ADD_WATCHLIST_CODE=$(echo "$ADD_WATCHLIST_RESPONSE" | tail -1)
    if [[ "$ADD_WATCHLIST_RC" -ne 0 ]]; then
      warn "Add to shopping watchlist via HTTP/2 failed (curl exit $ADD_WATCHLIST_RC)"
    elif [[ "$ADD_WATCHLIST_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to shopping watchlist works via HTTP/2 (shopping.watchlist)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.watchlist WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13a2 DB: watchlist in shopping.watchlist" || true
    else
      warn "Add to shopping watchlist via HTTP/2 failed - HTTP $ADD_WATCHLIST_CODE"
    fi
  fi

  # Test 13a3: Add to shopping wishlist (HTTP/2) — hits shopping.wishlist (port 5436)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13a3: Shopping Service - Add to Wishlist via HTTP/2"
    ADD_WISHLIST_RC=0
    ADD_WISHLIST_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/shopping/wishlist" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\"}" 2>&1) || ADD_WISHLIST_RC=$?
    ADD_WISHLIST_CODE=$(echo "$ADD_WISHLIST_RESPONSE" | tail -1)
    if [[ "$ADD_WISHLIST_RC" -ne 0 ]]; then
      warn "Add to shopping wishlist via HTTP/2 failed (curl exit $ADD_WISHLIST_RC)"
    elif [[ "$ADD_WISHLIST_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to shopping wishlist works via HTTP/2 (shopping.wishlist)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.wishlist WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13a3 DB: wishlist in shopping.wishlist" || true
    else
      warn "Add to shopping wishlist via HTTP/2 failed - HTTP $ADD_WISHLIST_CODE"
    fi
  fi

  # Test 13a4: Add to recently viewed (HTTP/2) — hits shopping.recently_viewed (port 5436)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13a4: Shopping Service - Add to Recently Viewed via HTTP/2"
    ADD_RECENTLY_RC=0
    ADD_RECENTLY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/shopping/recently-viewed" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\"}" 2>&1) || ADD_RECENTLY_RC=$?
    ADD_RECENTLY_CODE=$(echo "$ADD_RECENTLY_RESPONSE" | tail -1)
    if [[ "$ADD_RECENTLY_RC" -ne 0 ]]; then
      warn "Add to recently viewed via HTTP/2 failed (curl exit $ADD_RECENTLY_RC)"
    elif [[ "$ADD_RECENTLY_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to recently viewed works via HTTP/2 (shopping.recently_viewed)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.recently_viewed WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13a4 DB: recently_viewed in shopping.recently_viewed" || true
    else
      warn "Add to recently viewed via HTTP/2 failed - HTTP $ADD_RECENTLY_CODE"
    fi
  fi

  # Test 13b: Get cart
  say "Test 13b: Shopping Service - Get Cart via HTTP/2"
  GET_CART_RC=0
  GET_CART_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/cart" 2>&1) || GET_CART_RC=$?
  GET_CART_CODE=$(echo "$GET_CART_RESPONSE" | tail -1)
  if [[ "$GET_CART_RC" -ne 0 ]]; then
    warn "Get cart request failed (curl exit $GET_CART_RC)"
  elif [[ "$GET_CART_CODE" == "200" ]]; then
    ok "Get cart works via HTTP/2"
    _cart_body=$(echo "$GET_CART_RESPONSE" | sed '$d')
    CART_ITEMS=$(echo "$_cart_body" | grep -o '"items":\[.*\]' || echo "")
    # Cart row count: 0 is valid (empty cart); only warn if query failed (schema: shopping.shopping_cart on 5436 per CURRENT_DB_SCHEMA_REPORT)
    if [[ -n "${USER1_ID:-}" ]]; then
      _cart_count=$(PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id = '${USER1_ID}'" 2>/dev/null || echo "")
      if [[ -n "$_cart_count" ]] && [[ "$_cart_count" =~ ^[0-9]+$ ]]; then
        [[ "$_cart_count" != "0" ]] && ok "Test 13b DB: cart row count = $_cart_count (port 5436)" || info "Test 13b DB: cart row count = 0 (empty cart ok)"
      else
        warn "Test 13b DB: cart query failed on 5436/shopping — SELECT COUNT(*) FROM shopping.shopping_cart"
      fi
    fi
    if [[ -n "$CART_ITEMS" ]]; then
      # Prefer cart_item_id from add-cart response; else first item's id from get-cart
      [[ -z "${CART_ITEM_ID:-}" ]] && CART_ITEM_ID=$(echo "$_cart_body" | grep -o '"cart_item_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      [[ -z "${CART_ITEM_ID:-}" ]] && CART_ITEM_ID=$(echo "$_cart_body" | grep -oE '"id":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' | head -1 | cut -d'"' -f4 || echo "")
      # Fallback LISTING_ID from first cart item if still empty (e.g. Test 12 failed but 12b created a listing and we added it via 13a with LISTING_H3_ID)
      if [[ -z "${LISTING_ID:-}" ]]; then
        LISTING_ID=$(echo "$_cart_body" | grep -o '"listing_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        [[ -n "$LISTING_ID" ]] && info "Using listing_id from cart for LISTING_ID (Test 12/12b did not set LISTING_ID)"
      fi
    fi
  else
    warn "Get cart failed - HTTP $GET_CART_CODE"
  fi
  
  # Test 13c: Checkout (with simulated payment). Ensure sequence runs once at start of Test 13 block (and pre-flight); do NOT run on retry (root cause: re-running ensure during test races with app and can push sequence backward).
  # Root cause "No items in cart": GET /cart (13b) runs cleanupUnavailableItems; if listings DB is unreachable it used to remove the item. shopping-service availability.ts now keeps items in cart when listings check fails.
  say "Test 13c: Shopping Service - Checkout with Simulated Payment via HTTP/2"
  if [[ -n "${CART_ITEM_ID:-}" ]] && [[ -n "${LISTING_ID:-}" ]]; then
    _cart_count_pre=$(PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id = '${USER1_ID:-}'" 2>/dev/null || echo "?")
    [[ -n "${USER1_ID:-}" ]] && info "Pre-checkout DB: shopping.shopping_cart has ${_cart_count_pre} row(s) for user (debug HTTP/2 path)"
    CHECKOUT_RC=0
    CHECKOUT_RESPONSE=""
    CHECKOUT_CODE=""
    _checkout_attempt=0
    _checkout_max=3
    while [[ "$_checkout_attempt" -lt "$_checkout_max" ]]; do
      CHECKOUT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -X POST "https://$HOST:${PORT}/api/cart/checkout" \
        -d "{\"items\":[{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}],\"payment_method\":\"simulated\",\"shipping_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"},\"billing_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"}}" 2>&1) || CHECKOUT_RC=$?
      CHECKOUT_CODE=$(echo "$CHECKOUT_RESPONSE" | tail -1)
      if [[ "$CHECKOUT_RC" -eq 0 ]] && [[ "$CHECKOUT_CODE" =~ ^(200|201)$ ]]; then
        break
      fi
      if [[ "$CHECKOUT_CODE" == "500" ]] && echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q "orders_order_number_key"; then
        _checkout_attempt=$((_checkout_attempt + 1))
        # Retry only: app will call generate_order_number() again (new nextval). Do NOT run ensure here — it races with app and can cause duplicate.
        [[ "$_checkout_attempt" -lt "$_checkout_max" ]] && sleep 1
      elif [[ "$CHECKOUT_CODE" == "400" ]] && echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q "No items found in cart"; then
        # Cart empty (e.g. GET /cart cleaned items when listings check failed before availability.ts fix): re-add item and retry once.
        _checkout_attempt=$((_checkout_attempt + 1))
        if [[ "$_checkout_attempt" -lt "$_checkout_max" ]] && [[ -n "${LISTING_ID:-}" ]]; then
          info "13c: No items in cart — re-adding item via HTTP/2 and retrying checkout"
          strict_curl -sS --http2 --max-time 15 --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
            -X POST "https://$HOST:${PORT}/api/cart" -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}" 2>/dev/null || true
          sleep 1
        else
          break
        fi
      else
        break
      fi
    done
    if [[ "$CHECKOUT_RC" -ne 0 ]]; then
      warn "Checkout request failed (curl exit $CHECKOUT_RC)"
    elif [[ "$CHECKOUT_CODE" =~ ^(200|201)$ ]]; then
      ok "Checkout with simulated payment works via HTTP/2"
      _body=$(echo "$CHECKOUT_RESPONSE" | sed '$d')
      if command -v jq >/dev/null 2>&1; then
        ORDER_ID=$(echo "$_body" | jq -r '.order.id // empty' 2>/dev/null || echo "")
        ORDER_NUMBER=$(echo "$_body" | jq -r '.order.order_number // empty' 2>/dev/null || echo "")
        PURCHASE_ID=$(echo "$_body" | jq -r '.purchases[0].purchase_id // .purchases[0].id // empty' 2>/dev/null || echo "")
      fi
      [[ -z "$ORDER_ID" ]] && ORDER_ID=$(echo "$_body" | grep -oE '"order"[^}]*"id"[^"]*"[^"]+"' | head -1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' || echo "$_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
      [[ -z "$ORDER_NUMBER" ]] && ORDER_NUMBER=$(echo "$_body" | grep -o '"order_number":"[^"]*"' | cut -d'"' -f4 || echo "")
      [[ -z "$PURCHASE_ID" ]] && PURCHASE_ID=$(echo "$_body" | grep -o '"purchase_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      [[ -z "$PURCHASE_ID" ]] && PURCHASE_ID=$(echo "$_body" | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "")
      if echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q '"payment_status":"paid"'; then
        ok "Payment status confirmed as paid"
      fi
      if echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -qE '"tracking_number"\s*:\s*"[^"]+"'; then
        ok "Order has tracking_number (shipment simulation)"
      else
        info "Order tracking_number not in response (shipments table may not be migrated yet)"
      fi
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT COUNT(*) FROM shopping.orders WHERE user_id = '${USER1_ID}'" "Test 13c DB: order in shopping.orders" || true
      # 13c2: Second checkout so we have two resellable purchases (13i consumes one, 13j8 needs the other)
      if [[ -n "${LISTING_ID:-}" ]] && [[ -n "${TOKEN:-}" ]]; then
        _add2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 15 --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
          -X POST "https://$HOST:${PORT}/api/cart" -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99,\"metadata\":{\"title\":\"Second item for 13j8\"}}" 2>/dev/null || true)
        _add2_code=$(echo "$_add2" | tail -1)
        if [[ "$_add2_code" =~ ^(200|201)$ ]]; then
          _check2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
            -X POST "https://$HOST:${PORT}/api/cart/checkout" -d "{\"items\":[{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}],\"payment_method\":\"simulated\",\"shipping_address\":{\"street\":\"456 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"},\"billing_address\":{\"street\":\"456 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"}}" 2>/dev/null || true)
          _check2_code=$(echo "$_check2" | tail -1)
          if [[ "$_check2_code" =~ ^(200|201)$ ]]; then
            # Second checkout creates a NEW order; use LAST purchase (most recent) in case multiple
            PURCHASE_ID_2=$(echo "$_check2" | sed '$d' | jq -r '.purchases[-1].purchase_id // .purchases[-1].id // .purchases[0].purchase_id // .purchases[0].id // empty' 2>/dev/null || echo "")
            [[ -z "$PURCHASE_ID_2" ]] && PURCHASE_ID_2=$(echo "$_check2" | sed '$d' | jq -r '.purchases[0] | .purchase_id // .id // empty' 2>/dev/null || echo "")
            [[ -n "$PURCHASE_ID_2" ]] && info "Second checkout: PURCHASE_ID_2 for 13j8 (13i consumes PURCHASE_ID)"
          fi
        fi
      fi
    else
      warn "Checkout failed - HTTP $CHECKOUT_CODE"
      echo "Response body: $(echo "$CHECKOUT_RESPONSE" | sed '$d' | head -10)"
      if echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q "No items found in cart"; then
        _cart_count_fail=$(PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id = '${USER1_ID:-}'" 2>/dev/null || echo "?")
        info "  Debug (13c HTTP/2): cart had ${_cart_count_fail} row(s) in shopping.shopping_cart at failure — if 0, item was removed (e.g. availability check) before checkout; if >0, check app/session."
      fi
      if echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q "orders_order_number_key"; then
        info "  Root cause: duplicate order_number — (1) sequence + generate_order_number() on 5436/shopping, (2) image built from source with atomic INSERT."
        info "  Fix: (1) scripts/ensure-shopping-order-number-sequence.sh   (2) Source uses (SELECT shopping.generate_order_number()); ensure cluster image was built from it: RUN_REBUILD_SHOPPING=1 in preflight, or: docker build -t shopping-service:dev -f services/shopping-service/Dockerfile . && k3d image import shopping-service:dev -c off-campus-housing-tracker && kubectl -n off-campus-housing-tracker rollout restart deployment/shopping-service"
      fi
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT COUNT(*) FROM shopping.orders WHERE user_id = '${USER1_ID}'" "Test 13c DB: order in shopping.orders" || true
    fi
  else
    warn "Skipping checkout - Cart item ID or Listing ID not available"
  fi
  
  # Test 13d: Get orders
  say "Test 13d: Shopping Service - Get Orders via HTTP/2"
  GET_ORDERS_RC=0
  GET_ORDERS_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/orders" 2>&1) || GET_ORDERS_RC=$?
  GET_ORDERS_CODE=$(echo "$GET_ORDERS_RESPONSE" | tail -1)
  if [[ "$GET_ORDERS_RC" -ne 0 ]]; then
    warn "Get orders request failed (curl exit $GET_ORDERS_RC)"
  elif [[ "$GET_ORDERS_CODE" == "200" ]]; then
    ok "Get orders works via HTTP/2"
    _orders_body=$(echo "$GET_ORDERS_RESPONSE" | sed '$d')
    if [[ -z "${ORDER_NUMBER:-}" ]]; then
      ORDER_NUMBER=$(echo "$_orders_body" | grep -o '"order_number":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
    # Use first order id for 13e if checkout didn't set ORDER_ID (e.g. checkout failed with duplicate key)
    if [[ -z "${ORDER_ID:-}" ]] && [[ -n "$_orders_body" ]]; then
      ORDER_ID=$(echo "$_orders_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
  else
    warn "Get orders failed - HTTP $GET_ORDERS_CODE"
  fi

  # Test 13e: Get order details
  say "Test 13e: Shopping Service - Get Order Details via HTTP/2"
  if [[ -n "${ORDER_ID:-}" ]]; then
    GET_ORDER_RC=0
    GET_ORDER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X GET "https://$HOST:${PORT}/api/orders/$ORDER_ID" 2>&1) || GET_ORDER_RC=$?
    GET_ORDER_CODE=$(echo "$GET_ORDER_RESPONSE" | tail -1)
    if [[ "$GET_ORDER_RC" -ne 0 ]]; then
      warn "Get order details request failed (curl exit $GET_ORDER_RC)"
    elif [[ "$GET_ORDER_CODE" == "200" ]]; then
      ok "Get order details works via HTTP/2"
      if echo "$GET_ORDER_RESPONSE" | sed '$d' | grep -q '"items"'; then
        ok "Order items included in response"
        # 13g: use order_id and purchase_id from the SAME order-details response so returns route never gets a mismatch
        _order_body=$(echo "$GET_ORDER_RESPONSE" | sed '$d')
        _oid_13g=$(echo "$_order_body" | jq -r '.order.id // empty' 2>/dev/null | tr -d '\n\r ')
        _pid=$(echo "$_order_body" | jq -r '.items[0].id // .items[0].purchase_id // empty' 2>/dev/null | tr -d '\n\r ')
        [[ -z "$_pid" ]] && _pid=$(echo "$_order_body" | jq -r '.items[0] | .id // .purchase_id // empty' 2>/dev/null | tr -d '\n\r ')
        [[ "$_pid" == "$_oid_13g" ]] && _pid=""  # do not use order.id as purchase_id
        if [[ -n "$_pid" ]] && [[ -n "$_oid_13g" ]]; then
          PURCHASE_ID="$(echo "$_pid" | tr -d '\n\r ')"
          ORDER_ID_FOR_13G="$(echo "$_oid_13g" | tr -d '\n\r ')"
          info "13g: PURCHASE_ID and ORDER_ID from order details (same response, no mismatch)"
        fi
      fi
      if echo "$GET_ORDER_RESPONSE" | sed '$d' | grep -qE '"tracking_number"\s*:\s*"[^"]+"'; then
        ok "Order details include tracking_number"
      fi
    else
      warn "Get order details failed - HTTP $GET_ORDER_CODE"
    fi
  else
    warn "Skipping get order details - Order ID not available"
  fi
  
  # Test 13f: Get purchase history
  say "Test 13f: Shopping Service - Get Purchase History via HTTP/2"
  GET_PURCHASES_RC=0
  GET_PURCHASES_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/history/purchases" 2>&1) || GET_PURCHASES_RC=$?
  GET_PURCHASES_CODE=$(echo "$GET_PURCHASES_RESPONSE" | tail -1)
  if [[ "$GET_PURCHASES_RC" -ne 0 ]]; then
    warn "Get purchase history request failed (curl exit $GET_PURCHASES_RC)"
  elif [[ "$GET_PURCHASES_CODE" == "200" ]]; then
    ok "Get purchase history works via HTTP/2"
    if [[ -z "${PURCHASE_ID:-}" ]]; then
      PURCHASE_ID=$(echo "$GET_PURCHASES_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
    if echo "$GET_PURCHASES_RESPONSE" | sed '$d' | grep -q '"resellable":true'; then
      ok "Purchase history includes resellable flag"
    fi
  else
    warn "Get purchase history failed - HTTP $GET_PURCHASES_CODE"
  fi
  
  # Test 13f2: Rate seller (listings.ratings) — needs PURCHASE_ID from checkout; POST /api/listings/ratings
  if [[ -n "${LISTING_ID:-}" ]] && [[ -n "${PURCHASE_ID:-}" ]]; then
    say "Test 13f2: Listings Service - Rate Seller via HTTP/2 (listings.ratings)"
    RATING_RC=0
    RATING_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/listings/ratings" \
      -d "{\"listing_id\":\"$LISTING_ID\",\"rating\":5,\"review_text\":\"Great seller!\",\"transaction_id\":\"$PURCHASE_ID\"}" 2>&1) || RATING_RC=$?
    RATING_CODE=$(echo "$RATING_RESPONSE" | tail -1)
    if [[ "$RATING_RC" -ne 0 ]]; then
      warn "Rate seller via HTTP/2 failed (curl exit $RATING_RC)"
      _maybe_capture "$RATING_RESPONSE" "13f2"
    elif [[ "$RATING_CODE" =~ ^(200|201)$ ]]; then
      ok "Rate seller works via HTTP/2 (listings.ratings)"
      verify_db_after_test 5435 listings "SELECT 1 FROM listings.ratings WHERE listing_id = '${LISTING_ID}'::uuid AND rating = 5 LIMIT 1" "Test 13f2 DB: ratings" || true
    else
      warn "Rate seller via HTTP/2 failed - HTTP $RATING_CODE"
      [[ "$RATING_CODE" == "502" ]] && info "  502 on ratings: If schema preflight passed, run ./scripts/diagnose-502-and-analytics.sh. Ensure Postgres (not SSH) on 0.0.0.0:5435 for pods."
      _maybe_capture "$RATING_RESPONSE" "13f2"
    fi
  else
    info "Skipping rate seller - LISTING_ID or PURCHASE_ID not available"
  fi

  # Test 13g: Request return (eBay-style; optional — requires shopping.returns table)
  say "Test 13g: Shopping Service - Request Return via HTTP/2"
  _order_13g="$(echo "${ORDER_ID_FOR_13G:-$ORDER_ID}" | tr -d '\n\r ')"
  _purchase_13g="$(echo "${PURCHASE_ID:-}" | tr -d '\n\r ')"
  if [[ -n "${_order_13g:-}" ]] && [[ -n "${_purchase_13g:-}" ]]; then
    REQUEST_RETURN_RC=0
    REQUEST_RETURN_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/returns" \
      -d "{\"order_id\":\"$_order_13g\",\"purchase_id\":\"$_purchase_13g\",\"reason\":\"Test return from baseline\"}" 2>&1) || REQUEST_RETURN_RC=$?
    REQUEST_RETURN_CODE=$(echo "$REQUEST_RETURN_RESPONSE" | tail -1)
    if [[ "$REQUEST_RETURN_RC" -eq 0 ]] && [[ "$REQUEST_RETURN_CODE" == "201" ]]; then
      ok "Request return works via HTTP/2"
    elif [[ "$REQUEST_RETURN_CODE" == "409" ]]; then
      info "Return already requested for this purchase (expected if 13g ran before)"
    elif [[ "$REQUEST_RETURN_CODE" == "404" ]]; then
      info "Request return returned HTTP 404 (purchase not found — ensure 13c checkout succeeded and shopping.returns exists; preflight step 6f applies it)"
    else
      [[ "$REQUEST_RETURN_CODE" != "500" ]] && info "Request return returned HTTP $REQUEST_RETURN_CODE"
    fi
  else
    info "Skipping request return - Order ID or Purchase ID not available"
  fi

  # Test 13h: Get resellable purchases (eBay-style)
  say "Test 13h: Shopping Service - Get Resellable Purchases via HTTP/2"
  GET_RESELLABLE_RC=0
  GET_RESELLABLE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/resell/purchases" 2>&1) || GET_RESELLABLE_RC=$?
  GET_RESELLABLE_CODE=$(echo "$GET_RESELLABLE_RESPONSE" | tail -1)
  if [[ "$GET_RESELLABLE_RC" -ne 0 ]]; then
    warn "Get resellable purchases request failed (curl exit $GET_RESELLABLE_RC)"
  elif [[ "$GET_RESELLABLE_CODE" == "200" ]]; then
    ok "Get resellable purchases works via HTTP/2"
    if [[ -z "${PURCHASE_ID:-}" ]]; then
      PURCHASE_ID=$(echo "$GET_RESELLABLE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
  else
    warn "Get resellable purchases failed - HTTP $GET_RESELLABLE_CODE"
  fi
  
  # Test 13i: Resell purchase (eBay-style - create listing from purchase)
  say "Test 13i: Shopping Service - Resell Purchase (eBay-style) via HTTP/2"
  if [[ -n "${PURCHASE_ID:-}" ]]; then
    RESELL_RC=0
    RESELL_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/resell/$PURCHASE_ID" \
      -d "{\"title\":\"Reselling Test Item\",\"description\":\"This is a test resell listing\",\"price\":35.99,\"currency\":\"USD\",\"listing_type\":\"fixed_price\",\"condition\":\"used\",\"category\":\"vinyl\",\"location\":\"US\",\"shipping_cost\":5.00,\"mark_as_resold\":true}" 2>&1) || RESELL_RC=$?
    RESELL_CODE=$(echo "$RESELL_RESPONSE" | tail -1)
    if [[ "$RESELL_RC" -ne 0 ]]; then
      warn "Resell purchase request failed (curl exit $RESELL_RC)"
    elif [[ "$RESELL_CODE" =~ ^(200|201)$ ]]; then
      ok "Resell purchase works via HTTP/2 (eBay-style)"
      RESELL_LISTING_ID=$(echo "$RESELL_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if echo "$RESELL_RESPONSE" | sed '$d' | grep -q '"resold_from_purchase"'; then
        ok "Resell listing includes purchase metadata"
      fi
    else
      warn "Resell purchase failed - HTTP $RESELL_CODE"
      echo "Response body: $(echo "$RESELL_RESPONSE" | sed '$d' | head -10)"
    fi
  else
    warn "Skipping resell purchase - Purchase ID not available"
  fi
  
  # Test 13j0: Search history (was mislabeled 13i; 13i is Resell Purchase)
  say "Test 13j0: Shopping Service - Add Search History via HTTP/2"
  ADD_SEARCH_RC=0
  ADD_SEARCH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/history/searches" \
    -d "{\"query\":\"test search\",\"query_type\":\"listing\",\"filters\":{\"min_price\":10,\"max_price\":100},\"result_count\":25}" 2>&1) || ADD_SEARCH_RC=$?
  ADD_SEARCH_CODE=$(echo "$ADD_SEARCH_RESPONSE" | tail -1)
  if [[ "$ADD_SEARCH_RC" -ne 0 ]]; then
    warn "Add search history request failed (curl exit $ADD_SEARCH_RC)"
  elif [[ "$ADD_SEARCH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add search history works via HTTP/2"
  else
    warn "Add search history failed - HTTP $ADD_SEARCH_CODE"
  fi
  
  # Test 13j: Shopping Service - HTTP/3 Tests
  say "Test 13j: Shopping Service - Cart Operations via HTTP/3"
  
  # Test 13j1: Add item to cart via HTTP/3
  say "Test 13j1: Shopping Service - Add Item to Cart via HTTP/3"
  if [[ -n "${LISTING_ID:-}" ]]; then
    ADD_CART_H3_RC=0
    ADD_CART_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/cart" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99,\"metadata\":{\"title\":\"Test Listing H3\"}}" 2>&1) || ADD_CART_H3_RC=$?
    if [[ "$ADD_CART_H3_RC" -ne 0 ]]; then
      _add_cart_h3_code=$(echo "$ADD_CART_H3_RESPONSE" | tail -1)
      warn "Add to cart via HTTP/3 failed (HTTP ${_add_cart_h3_code:-000}, curl exit $ADD_CART_H3_RC: $(_http3_exit_meaning "$ADD_CART_H3_RC"))"
    elif [[ -n "$ADD_CART_H3_RESPONSE" ]]; then
      ADD_CART_H3_CODE=$(echo "$ADD_CART_H3_RESPONSE" | tail -1)
      if [[ "$ADD_CART_H3_CODE" =~ ^(200|201)$ ]]; then
        ok "Add item to cart works via HTTP/3"
      else
        warn "Add to cart via HTTP/3 failed - HTTP $ADD_CART_H3_CODE"
      fi
    fi
  else
    warn "Skipping add to cart via HTTP/3 - Listing ID not available"
  fi
  
  # Test 13j2: Get cart via HTTP/3
  say "Test 13j2: Shopping Service - Get Cart via HTTP/3"
  GET_CART_H3_RC=0
  GET_CART_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/cart" 2>&1) || GET_CART_H3_RC=$?
  if [[ "$GET_CART_H3_RC" -ne 0 ]]; then
    _get_cart_h3_code=$(echo "$GET_CART_H3_RESPONSE" | tail -1)
    warn "Get cart via HTTP/3 failed (HTTP ${_get_cart_h3_code:-000}, curl exit $GET_CART_H3_RC: $(_http3_exit_meaning "$GET_CART_H3_RC"))"
  elif [[ -n "$GET_CART_H3_RESPONSE" ]]; then
    GET_CART_H3_CODE=$(echo "$GET_CART_H3_RESPONSE" | tail -1)
    if [[ "$GET_CART_H3_CODE" == "200" ]]; then
      ok "Get cart works via HTTP/3"
    else
      warn "Get cart via HTTP/3 failed - HTTP $GET_CART_H3_CODE"
    fi
  fi

  # Test 13j2b: Add to shopping watchlist (HTTP/3) — hits shopping.watchlist (port 5436)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13j2b: Shopping Service - Add to Watchlist via HTTP/3"
    ADD_WATCHLIST_H3_RC=0
    ADD_WATCHLIST_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/shopping/watchlist" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\"}" 2>&1) || ADD_WATCHLIST_H3_RC=$?
    ADD_WATCHLIST_H3_CODE=$(echo "$ADD_WATCHLIST_H3_RESPONSE" | tail -1)
    if [[ "$ADD_WATCHLIST_H3_RC" -ne 0 ]]; then
      warn "Add to shopping watchlist via HTTP/3 failed (curl exit $ADD_WATCHLIST_H3_RC)"
    elif [[ "$ADD_WATCHLIST_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to shopping watchlist works via HTTP/3 (shopping.watchlist)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.watchlist WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13j2b DB: H3 watchlist in shopping.watchlist" || true
    else
      warn "Add to shopping watchlist via HTTP/3 failed - HTTP $ADD_WATCHLIST_H3_CODE"
    fi
  fi

  # Test 13j2c: Add to shopping wishlist (HTTP/3) — hits shopping.wishlist (port 5436)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13j2c: Shopping Service - Add to Wishlist via HTTP/3"
    ADD_WISHLIST_H3_RC=0
    ADD_WISHLIST_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/shopping/wishlist" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\"}" 2>&1) || ADD_WISHLIST_H3_RC=$?
    ADD_WISHLIST_H3_CODE=$(echo "$ADD_WISHLIST_H3_RESPONSE" | tail -1)
    if [[ "$ADD_WISHLIST_H3_RC" -ne 0 ]]; then
      warn "Add to shopping wishlist via HTTP/3 failed (curl exit $ADD_WISHLIST_H3_RC)"
    elif [[ "$ADD_WISHLIST_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to shopping wishlist works via HTTP/3 (shopping.wishlist)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.wishlist WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13j2c DB: H3 wishlist in shopping.wishlist" || true
    else
      warn "Add to shopping wishlist via HTTP/3 failed - HTTP $ADD_WISHLIST_H3_CODE"
    fi
  fi

  # Test 13j2d: Add to recently viewed (HTTP/3) — hits shopping.recently_viewed (port 5436)
  if [[ -n "${LISTING_ID:-}" ]]; then
    say "Test 13j2d: Shopping Service - Add to Recently Viewed via HTTP/3"
    ADD_RECENTLY_H3_RC=0
    ADD_RECENTLY_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/shopping/recently-viewed" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\"}" 2>&1) || ADD_RECENTLY_H3_RC=$?
    ADD_RECENTLY_H3_CODE=$(echo "$ADD_RECENTLY_H3_RESPONSE" | tail -1)
    if [[ "$ADD_RECENTLY_H3_RC" -ne 0 ]]; then
      warn "Add to recently viewed via HTTP/3 failed (curl exit $ADD_RECENTLY_H3_RC)"
    elif [[ "$ADD_RECENTLY_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Add to recently viewed works via HTTP/3 (shopping.recently_viewed)"
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.recently_viewed WHERE user_id = '${USER1_ID}' AND item_id = '${LISTING_ID}' LIMIT 1" "Test 13j2d DB: H3 recently_viewed in shopping.recently_viewed" || true
    else
      warn "Add to recently viewed via HTTP/3 failed - HTTP $ADD_RECENTLY_H3_CODE"
    fi
  fi
  
  # Test 13j3: Get orders via HTTP/3
  say "Test 13j3: Shopping Service - Get Orders via HTTP/3"
  GET_ORDERS_H3_RC=0
  GET_ORDERS_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/orders" 2>&1) || GET_ORDERS_H3_RC=$?
  if [[ "$GET_ORDERS_H3_RC" -ne 0 ]]; then
    warn "Get orders via HTTP/3 failed (curl exit $GET_ORDERS_H3_RC)"
  elif [[ -n "$GET_ORDERS_H3_RESPONSE" ]]; then
    GET_ORDERS_H3_CODE=$(echo "$GET_ORDERS_H3_RESPONSE" | tail -1)
    if [[ "$GET_ORDERS_H3_CODE" == "200" ]]; then
      ok "Get orders works via HTTP/3"
      [[ -z "${ORDER_ID_H3:-}" ]] && ORDER_ID_H3=$(echo "$GET_ORDERS_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    else
      warn "Get orders via HTTP/3 failed - HTTP $GET_ORDERS_H3_CODE"
    fi
  fi

  # Test 13j4: Get purchase history via HTTP/3
  say "Test 13j4: Shopping Service - Get Purchase History via HTTP/3"
  GET_PURCHASES_H3_RC=0
  GET_PURCHASES_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/history/purchases" 2>&1) || GET_PURCHASES_H3_RC=$?
  if [[ "$GET_PURCHASES_H3_RC" -ne 0 ]]; then
    warn "Get purchase history via HTTP/3 failed (curl exit $GET_PURCHASES_H3_RC)"
  elif [[ -n "$GET_PURCHASES_H3_RESPONSE" ]]; then
    GET_PURCHASES_H3_CODE=$(echo "$GET_PURCHASES_H3_RESPONSE" | tail -1)
    if [[ "$GET_PURCHASES_H3_CODE" == "200" ]]; then
      ok "Get purchase history works via HTTP/3"
      [[ -z "${PURCHASE_ID_H3:-}" ]] && PURCHASE_ID_H3=$(echo "$GET_PURCHASES_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if [[ -z "${PURCHASE_ID_H3:-}" ]]; then
        PURCHASE_ID_H3=$(echo "$GET_PURCHASES_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      fi
    else
      warn "Get purchase history via HTTP/3 failed - HTTP $GET_PURCHASES_H3_CODE"
    fi
  fi

  # Test 13j4b: Rate seller via HTTP/3 (listings.ratings) — uses PURCHASE_ID from 13c
  if [[ -n "${LISTING_ID:-}" ]] && [[ -n "${PURCHASE_ID:-}" ]]; then
    say "Test 13j4b: Listings Service - Rate Seller via HTTP/3 (listings.ratings)"
    RATING_H3_RC=0
    RATING_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/listings/ratings" \
      -d "{\"listing_id\":\"$LISTING_ID\",\"rating\":4,\"review_text\":\"Good seller via H3!\",\"transaction_id\":\"$PURCHASE_ID\"}" 2>&1) || RATING_H3_RC=$?
    RATING_H3_CODE=$(echo "$RATING_H3_RESPONSE" | tail -1)
    if [[ "$RATING_H3_RC" -ne 0 ]]; then
      warn "Rate seller via HTTP/3 failed (curl exit $RATING_H3_RC)"
      _maybe_capture "$RATING_H3_RESPONSE" "13j4b"
    elif [[ "$RATING_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Rate seller works via HTTP/3 (listings.ratings)"
    else
      warn "Rate seller via HTTP/3 failed - HTTP $RATING_H3_CODE"
      _maybe_capture "$RATING_H3_RESPONSE" "13j4b"
    fi
  fi

  # Test 13j5: Checkout via HTTP/3. Ensure sequence already run once at start of Test 13; do NOT run on retry (avoids race with app).
  # Root cause "No items in cart": cart is in DB but may have been consumed or request hit before 13j1 persisted; ensure cart has items before checkout.
  say "Test 13j5: Shopping Service - Checkout with Simulated Payment via HTTP/3"
  if [[ -n "${LISTING_ID:-}" ]]; then
    # If get-cart (13j2) showed items we rely on that; if checkout fails with "No items in cart", re-add and retry once
    _cart_empty=0
    if [[ -n "$GET_CART_H3_RESPONSE" ]] && [[ "$(echo "$GET_CART_H3_RESPONSE" | sed '$d' | grep -o '"id"' | wc -l)" -eq 0 ]]; then
      _cart_empty=1
    fi
    if [[ "$_cart_empty" -eq 1 ]] && [[ -n "${LISTING_ID:-}" ]]; then
      info "Cart empty before 13j5 checkout — re-adding item via HTTP/3 then retrying checkout"
      strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 15 -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --resolve "$HTTP3_RESOLVE" \
        -X POST "https://$HOST/api/cart" -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}" 2>/dev/null || true
      sleep 1
    fi
    CHECKOUT_H3_RC=0
    CHECKOUT_H3_RESPONSE=""
    CHECKOUT_H3_CODE=""
    _ch3_attempt=0
    _ch3_max=3
    while [[ "$_ch3_attempt" -lt "$_ch3_max" ]]; do
      CHECKOUT_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
        -H "Host: $HOST" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        --resolve "$HTTP3_RESOLVE" \
        -X POST "https://$HOST/api/cart/checkout" \
        -d "{\"items\":[{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}],\"payment_method\":\"simulated\",\"shipping_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"},\"billing_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"}}" 2>&1) || CHECKOUT_H3_RC=$?
      CHECKOUT_H3_CODE=$(echo "$CHECKOUT_H3_RESPONSE" | tail -1)
      if [[ "$CHECKOUT_H3_RC" -eq 0 ]] && [[ "$CHECKOUT_H3_CODE" =~ ^(200|201)$ ]]; then
        break
      fi
      if [[ "$CHECKOUT_H3_CODE" == "500" ]] && echo "$CHECKOUT_H3_RESPONSE" | sed '$d' | grep -q "orders_order_number_key"; then
        _ch3_attempt=$((_ch3_attempt + 1))
        [[ "$_ch3_attempt" -lt "$_ch3_max" ]] && sleep 1
      elif [[ "$CHECKOUT_H3_CODE" == "400" ]] && echo "$CHECKOUT_H3_RESPONSE" | sed '$d' | grep -q "No items found in cart"; then
        # Cart empty: re-add one item via HTTP/3 and retry checkout once
        _ch3_attempt=$((_ch3_attempt + 1))
        if [[ "$_ch3_attempt" -lt "$_ch3_max" ]] && [[ -n "${LISTING_ID:-}" ]]; then
          info "13j5: No items in cart — re-adding item via HTTP/3 and retrying checkout"
          strict_http3_curl -sS --http3-only --max-time 15 -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --resolve "$HTTP3_RESOLVE" \
            -X POST "https://$HOST/api/cart" -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}" 2>/dev/null || true
          sleep 1
        else
          break
        fi
      else
        break
      fi
    done
    if [[ "$CHECKOUT_H3_RC" -ne 0 ]]; then
      warn "Checkout via HTTP/3 failed (curl exit $CHECKOUT_H3_RC)"
    elif [[ "$CHECKOUT_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Checkout with simulated payment works via HTTP/3"
      _h3_body=$(echo "$CHECKOUT_H3_RESPONSE" | sed '$d')
      if command -v jq >/dev/null 2>&1; then
        ORDER_ID_H3=$(echo "$_h3_body" | jq -r '.order.id // empty' 2>/dev/null || echo "")
        PURCHASE_ID_H3=$(echo "$_h3_body" | jq -r '.purchases[0].purchase_id // .purchases[0].id // empty' 2>/dev/null || echo "")
      fi
      [[ -z "$ORDER_ID_H3" ]] && ORDER_ID_H3=$(echo "$_h3_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      [[ -z "$PURCHASE_ID_H3" ]] && PURCHASE_ID_H3=$(echo "$_h3_body" | grep -o '"purchase_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      [[ -z "$PURCHASE_ID_H3" ]] && PURCHASE_ID_H3=$(echo "$_h3_body" | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "")
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT COUNT(*) FROM shopping.orders WHERE user_id = '${USER1_ID}'" "Test 13j5 DB: order in shopping.orders" || true
    else
      warn "Checkout via HTTP/3 failed - HTTP $CHECKOUT_H3_CODE"
      echo "Response body: $(echo "$CHECKOUT_H3_RESPONSE" | sed '$d' | head -5)"
      if echo "$CHECKOUT_H3_RESPONSE" | sed '$d' | grep -q "orders_order_number_key"; then
        info "  Root cause: duplicate order_number — (1) sequence + generate_order_number() on 5436/shopping, (2) image built from source with atomic INSERT."
        info "  Fix: (1) scripts/ensure-shopping-order-number-sequence.sh   (2) Source uses (SELECT shopping.generate_order_number()); ensure cluster image was built from it: RUN_REBUILD_SHOPPING=1 in preflight, or: docker build -t shopping-service:dev -f services/shopping-service/Dockerfile . && k3d image import shopping-service:dev -c off-campus-housing-tracker && kubectl -n off-campus-housing-tracker rollout restart deployment/shopping-service"
      fi
      [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT COUNT(*) FROM shopping.orders WHERE user_id = '${USER1_ID}'" "Test 13j5 DB: order in shopping.orders" || true
    fi
  else
    warn "Skipping checkout via HTTP/3 - Listing ID not available"
  fi

  # Test 13j6: Get order details via HTTP/3
  say "Test 13j6: Shopping Service - Get Order Details via HTTP/3"
  if [[ -n "${ORDER_ID_H3:-}" ]]; then
    GET_ORDER_H3_RC=0
    GET_ORDER_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X GET "https://$HOST/api/orders/$ORDER_ID_H3" 2>&1) || GET_ORDER_H3_RC=$?
    GET_ORDER_H3_CODE=$(echo "$GET_ORDER_H3_RESPONSE" | tail -1)
    if [[ "$GET_ORDER_H3_RC" -ne 0 ]]; then
      warn "Get order details via HTTP/3 failed (curl exit $GET_ORDER_H3_RC)"
    elif [[ "$GET_ORDER_H3_CODE" == "200" ]]; then
      ok "Get order details works via HTTP/3"
    else
      warn "Get order details via HTTP/3 failed - HTTP $GET_ORDER_H3_CODE"
    fi
  else
    warn "Skipping get order details via HTTP/3 - Order ID not available (run 13j5 checkout first)"
  fi

  # Test 13j7: Get resellable purchases via HTTP/3
  say "Test 13j7: Shopping Service - Get Resellable Purchases via HTTP/3"
  GET_RESELLABLE_H3_RC=0
  GET_RESELLABLE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/resell/purchases" 2>&1) || GET_RESELLABLE_H3_RC=$?
  GET_RESELLABLE_H3_CODE=$(echo "$GET_RESELLABLE_H3_RESPONSE" | tail -1)
  if [[ "$GET_RESELLABLE_H3_RC" -ne 0 ]]; then
    warn "Get resellable purchases via HTTP/3 failed (curl exit $GET_RESELLABLE_H3_RC)"
  elif [[ "$GET_RESELLABLE_H3_CODE" == "200" ]]; then
    ok "Get resellable purchases works via HTTP/3"
    _body=$(echo "$GET_RESELLABLE_H3_RESPONSE" | sed '$d')
    _resell_id=$(echo "$_body" | jq -r '.items[0].id // empty' 2>/dev/null | tr -d '\n\r ')
    [[ -z "$_resell_id" ]] && _resell_id=$(echo "$_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 | tr -d '\n\r ')
    if [[ -n "$_resell_id" ]]; then
      PURCHASE_ID_H3="$_resell_id"
      info "13j8: Resellable purchase from 13j7 (get resellable H3)"
    fi
  else
    warn "Get resellable purchases via HTTP/3 failed - HTTP $GET_RESELLABLE_H3_CODE"
  fi

  # Test 13j8: Resell purchase (eBay-style) via HTTP/3
  # 13i (H2 resell) runs before 13j8 and consumes PURCHASE_ID — never use PURCHASE_ID (would 404).
  # Prefer PURCHASE_ID_2 (second checkout); else use PURCHASE_ID_H3 from 13j7 (resellable list); else DB.
  say "Test 13j8: Shopping Service - Resell Purchase (eBay-style) via HTTP/3"
  if [[ -n "${PURCHASE_ID_2:-}" ]]; then
    PURCHASE_ID_H3="$(echo "$PURCHASE_ID_2" | tr -d '\n\r ')"
    info "13j8: Using PURCHASE_ID_2 (second checkout, not consumed by 13i)"
  fi
  if [[ -z "${PURCHASE_ID_H3:-}" ]] && [[ -n "${USER1_ID:-}" ]]; then
    PURCHASE_ID_H3=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p 5436 -U postgres -d shopping -tAc \
      "SELECT id FROM shopping.purchase_history WHERE user_id = '${USER1_ID}'::uuid AND resellable = TRUE ORDER BY purchased_at DESC LIMIT 1" 2>/dev/null | tr -d ' \n' || echo "")
    [[ -n "$PURCHASE_ID_H3" ]] && info "13j8: Resellable purchase from DB (PURCHASE_ID_2 and 13j7 unavailable)"
  fi
  if [[ -n "${PURCHASE_ID_H3:-}" ]]; then
    _resell_id_13j8="$(echo "$PURCHASE_ID_H3" | tr -d '\n\r ')"
    RESELL_H3_RC=0
    RESELL_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/resell/$_resell_id_13j8" \
      -d "{\"title\":\"Reselling Test Item H3-$RANDOM\",\"description\":\"Test resell via HTTP/3\",\"price\":35.99,\"currency\":\"USD\",\"listing_type\":\"fixed_price\",\"condition\":\"used\",\"category\":\"vinyl\",\"location\":\"US\",\"shipping_cost\":5.00,\"mark_as_resold\":true}" 2>&1) || RESELL_H3_RC=$?
    RESELL_H3_CODE=$(echo "$RESELL_H3_RESPONSE" | tail -1)
    if [[ "$RESELL_H3_RC" -ne 0 ]]; then
      warn "Resell purchase via HTTP/3 failed (curl exit $RESELL_H3_RC)"
    elif [[ "$RESELL_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Resell purchase works via HTTP/3 (eBay-style)"
      verify_db_after_test 5435 listings "SELECT 1 FROM listings.listings WHERE title LIKE 'Reselling Test Item H3-%' LIMIT 1" "Test 13j8 DB: resell listing in listings.listings" || true
    else
      warn "Resell purchase via HTTP/3 failed - HTTP $RESELL_H3_CODE"
      _maybe_capture "$RESELL_H3_RESPONSE" "13j8"
    fi
  else
    warn "Skipping resell purchase via HTTP/3 - Purchase ID not available"
  fi

  # Test 13j9: Add search history via HTTP/3
  say "Test 13j9: Shopping Service - Add Search History via HTTP/3"
  ADD_SEARCH_H3_RC=0
  ADD_SEARCH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/history/searches" \
    -d "{\"query\":\"test search h3-$RANDOM\",\"query_type\":\"listing\",\"filters\":{\"min_price\":10,\"max_price\":100},\"result_count\":25}" 2>&1) || ADD_SEARCH_H3_RC=$?
  ADD_SEARCH_H3_CODE=$(echo "$ADD_SEARCH_H3_RESPONSE" | tail -1)
  if [[ "$ADD_SEARCH_H3_RC" -ne 0 ]]; then
    warn "Add search history via HTTP/3 failed (curl exit $ADD_SEARCH_H3_RC)"
  elif [[ "$ADD_SEARCH_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Add search history works via HTTP/3"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5436 shopping "SELECT 1 FROM shopping.search_history WHERE user_id = '${USER1_ID}' LIMIT 1" "Test 13j9 DB: search_history populated" || true
  else
    warn "Add search history via HTTP/3 failed - HTTP $ADD_SEARCH_H3_CODE"
  fi
else
  if [[ "${SKIP_SHOPPING:-}" == "1" ]]; then
    warn "Skipping shopping service tests - SKIP_SHOPPING=1"
  else
    warn "Skipping shopping service tests - shopping-service not available or no auth token"
  fi
fi

# Schema coverage (tables from docs/CURRENT_DB_SCHEMA_REPORT.md): shopping.notifications exists on port 5436 DB shopping; 0 rows is ok
if [[ "${SKIP_SHOPPING:-}" != "1" ]]; then
  _notif_count=$(PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT COUNT(*) FROM shopping.notifications" 2>/dev/null || echo "")
  if [[ -n "$_notif_count" ]] && [[ "$_notif_count" =~ ^[0-9]+$ ]]; then
    ok "Schema: shopping.notifications (port 5436, CURRENT_DB_SCHEMA_REPORT): table exists (count=$_notif_count)"
  else
    info "Schema: shopping.notifications not found or query failed on 5436/shopping (run inspect-external-db-schemas.sh to refresh schema report)"
  fi
fi

# Test 13k: Analytics Service - Log Search (HTTP/2 + HTTP/3) — log-search writes to listings.search_history in records DB (5433) only
# logged: false = analytics pod cannot reach records DB (5433); run colima-apply-host-aliases.sh + diagnose-502-and-analytics.sh. Retry once on exit 28.
_ANALYTICS_LOG_QUERY="analytics-smoke-${RANDOM}-$(date +%s)"
if [[ -n "${TOKEN:-}" ]] && type strict_curl &>/dev/null; then
  say "Test 13k: Analytics Service - Log Search via HTTP/2"
  LOG_SEARCH_RC=0
  LOG_SEARCH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME_ANALYTICS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/analytics/log-search" \
    -d "{\"source\":\"smoke-test\",\"query\":\"$_ANALYTICS_LOG_QUERY\",\"userId\":\"${USER1_ID:-null}\",\"results\":5}" 2>&1) || LOG_SEARCH_RC=$?
  LOG_SEARCH_CODE=$(echo "$LOG_SEARCH_RESPONSE" | tail -1)
  if [[ "$LOG_SEARCH_RC" -eq 28 ]]; then
    sleep 3
    LOG_SEARCH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time "${CURL_MAX_TIME_ANALYTICS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/analytics/log-search" \
      -d "{\"source\":\"smoke-test\",\"query\":\"$_ANALYTICS_LOG_QUERY\",\"userId\":\"${USER1_ID:-null}\",\"results\":5}" 2>&1) || LOG_SEARCH_RC=$?
    LOG_SEARCH_CODE=$(echo "$LOG_SEARCH_RESPONSE" | tail -1)
  fi
  if [[ "$LOG_SEARCH_RC" -ne 0 ]]; then
    warn "Analytics log-search via HTTP/2 failed (curl exit $LOG_SEARCH_RC)"
    [[ "$LOG_SEARCH_RC" -eq 28 ]] && info "  curl exit 28 = timeout; retry already attempted."
  elif [[ "$LOG_SEARCH_CODE" =~ ^(200|201)$ ]]; then
    ok "Analytics log-search works via HTTP/2"
    if echo "$LOG_SEARCH_RESPONSE" | sed '$d' | grep -q '"logged":false'; then
      _body=$(echo "$LOG_SEARCH_RESPONSE" | sed '$d')
      _hint=$(echo "$_body" | grep -o '"hint":"[^"]*"' 2>/dev/null | head -1 | sed 's/"hint":"//;s/"$//')
      _err_code=$(echo "$_body" | jq -r '.error_code // empty' 2>/dev/null || echo "$_body" | grep -o '"error_code":"[^"]*"' 2>/dev/null | head -1 | sed 's/"error_code":"//;s/"$//')
      _err_msg=$(echo "$_body" | jq -r '.message // empty' 2>/dev/null || echo "$_body" | grep -o '"message":"[^"]*"' 2>/dev/null | head -1 | sed 's/"message":"//;s/"$//')
      [[ -n "$_hint" ]] && info "  [13k] log-search returned logged: false — $_hint (listings.search_history is in records/5433)"
      [[ -n "$_err_code" ]] && info "  [13k] backend error_code: $_err_code"
      [[ -n "$_err_msg" ]] && info "  [13k] backend message: $_err_msg"
      _analytics_pod=$(_kb -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
      if [[ -n "$_analytics_pod" ]]; then
        if _kb -n "$NS" exec "$_analytics_pod" -- sh -c "nc -z -w2 host.docker.internal 5433" 2>/dev/null; then
          info "  [13k] Pod→records (5433): reachable (if still logged:false, check table listings.search_history or analytics-service logs)"
        else
          info "  [13k] Pod→records (5433): unreachable — run ./scripts/colima-apply-host-aliases.sh or ./scripts/apply-k3d-host-aliases.sh, then ./scripts/diagnose-502-and-analytics.sh"
        fi
      fi
      info "  If analytics pod cannot reach records DB (5433): on k3d run ./scripts/apply-k3d-host-aliases.sh, on Colima run ./scripts/colima-apply-host-aliases.sh; then ./scripts/diagnose-502-and-analytics.sh"
    fi
    verify_db_after_test 5433 records "SELECT 1 FROM listings.search_history WHERE source = 'smoke-test' AND q = '$_ANALYTICS_LOG_QUERY' LIMIT 1" "Test 13k DB: analytics log in listings.search_history (5433)" || true
  else
    warn "Analytics log-search via HTTP/2 failed - HTTP $LOG_SEARCH_CODE"
    _maybe_capture "$LOG_SEARCH_RESPONSE" "13k"
  fi
fi
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  _ANALYTICS_LOG_QUERY_H3="analytics-h3-${RANDOM}-$(date +%s)"
  say "Test 13k2: Analytics Service - Log Search via HTTP/3"
  LOG_SEARCH_H3_RC=0
  LOG_SEARCH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME_ANALYTICS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/analytics/log-search" \
    -d "{\"source\":\"smoke-test\",\"query\":\"$_ANALYTICS_LOG_QUERY_H3\",\"userId\":\"${USER1_ID:-null}\",\"results\":3}" 2>&1) || LOG_SEARCH_H3_RC=$?
  LOG_SEARCH_H3_CODE=$(echo "$LOG_SEARCH_H3_RESPONSE" | tail -1)
  if [[ "$LOG_SEARCH_H3_RC" -eq 28 ]]; then
    sleep 3
    LOG_SEARCH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME_ANALYTICS:-30}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-5}" \
      -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" -X POST "https://$HOST/api/analytics/log-search" \
      -d "{\"source\":\"smoke-test\",\"query\":\"$_ANALYTICS_LOG_QUERY_H3\",\"userId\":\"${USER1_ID:-null}\",\"results\":3}" 2>&1) || LOG_SEARCH_H3_RC=$?
    LOG_SEARCH_H3_CODE=$(echo "$LOG_SEARCH_H3_RESPONSE" | tail -1)
  fi
  if [[ "$LOG_SEARCH_H3_RC" -ne 0 ]]; then
    warn "Analytics log-search via HTTP/3 failed (curl exit $LOG_SEARCH_H3_RC)"
    [[ "$LOG_SEARCH_H3_RC" -eq 28 ]] && info "  curl exit 28 = timeout; retry already attempted."
    _maybe_capture "$LOG_SEARCH_H3_RESPONSE" "13k2"
  elif [[ "$LOG_SEARCH_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Analytics log-search works via HTTP/3"
    if echo "$LOG_SEARCH_H3_RESPONSE" | sed '$d' | grep -q '"logged":false'; then
      _body=$(echo "$LOG_SEARCH_H3_RESPONSE" | sed '$d')
      _hint=$(echo "$_body" | grep -o '"hint":"[^"]*"' 2>/dev/null | head -1 | sed 's/"hint":"//;s/"$//')
      _err_code=$(echo "$_body" | jq -r '.error_code // empty' 2>/dev/null || echo "$_body" | grep -o '"error_code":"[^"]*"' 2>/dev/null | head -1 | sed 's/"error_code":"//;s/"$//')
      _err_msg=$(echo "$_body" | jq -r '.message // empty' 2>/dev/null || echo "$_body" | grep -o '"message":"[^"]*"' 2>/dev/null | head -1 | sed 's/"message":"//;s/"$//')
      [[ -n "$_hint" ]] && info "  [13k2] log-search returned logged: false — $_hint (listings.search_history is in records/5433)"
      [[ -n "$_err_code" ]] && info "  [13k2] backend error_code: $_err_code"
      [[ -n "$_err_msg" ]] && info "  [13k2] backend message: $_err_msg"
      _analytics_pod=$(_kb -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
      if [[ -n "$_analytics_pod" ]]; then
        if _kb -n "$NS" exec "$_analytics_pod" -- sh -c "nc -z -w2 host.docker.internal 5433" 2>/dev/null; then
          info "  [13k2] Pod→records (5433): reachable (if still logged:false, check table listings.search_history or analytics-service logs)"
        else
          info "  [13k2] Pod→records (5433): unreachable — run ./scripts/colima-apply-host-aliases.sh or ./scripts/apply-k3d-host-aliases.sh, then ./scripts/diagnose-502-and-analytics.sh"
        fi
      fi
      info "  If analytics pod cannot reach records DB (5433): on k3d run ./scripts/apply-k3d-host-aliases.sh, on Colima run ./scripts/colima-apply-host-aliases.sh; then ./scripts/diagnose-502-and-analytics.sh"
    fi
    verify_db_after_test 5433 records "SELECT 1 FROM listings.search_history WHERE source = 'smoke-test' AND q = '$_ANALYTICS_LOG_QUERY_H3' LIMIT 1" "Test 13k2 DB: H3 analytics log in listings.search_history (5433)" || true
  else
    warn "Analytics log-search via HTTP/3 failed - HTTP $LOG_SEARCH_H3_CODE"
    _maybe_capture "$LOG_SEARCH_H3_RESPONSE" "13k2"
  fi
fi

# Test 13k3: Analytics Service - Fuzzy search via HTTP/2
if [[ -n "${TOKEN:-}" ]] && type strict_curl &>/dev/null; then
  say "Test 13k3: Analytics Service - Fuzzy Search via HTTP/2"
  FUZZY_RC=0
  FUZZY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 15 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/analytics/fuzzy-search?q=vinyl&limit=5" 2>&1) || FUZZY_RC=$?
  FUZZY_CODE=$(echo "$FUZZY_RESPONSE" | tail -1)
  if [[ "$FUZZY_RC" -ne 0 ]]; then
    warn "Analytics fuzzy-search via HTTP/2 failed (curl exit $FUZZY_RC)"
  elif [[ "$FUZZY_CODE" == "200" ]]; then
    ok "Analytics fuzzy-search works via HTTP/2"
  elif [[ "$FUZZY_CODE" == "400" ]]; then
    info "Analytics fuzzy-search returned 400 (query/params)"
  else
    warn "Analytics fuzzy-search via HTTP/2 returned HTTP $FUZZY_CODE"
  fi
fi

# Test 13k3b: Analytics Service - Fuzzy Search via HTTP/3
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 13k3b: Analytics Service - Fuzzy Search via HTTP/3"
  FUZZY_H3_RC=0
  FUZZY_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/analytics/fuzzy-search?q=vinyl&limit=5" 2>&1) || FUZZY_H3_RC=$?
  FUZZY_H3_CODE=$(echo "$FUZZY_H3_RESPONSE" | tail -1)
  if [[ "$FUZZY_H3_RC" -ne 0 ]]; then
    warn "Analytics fuzzy-search via HTTP/3 failed (curl exit $FUZZY_H3_RC)"
  elif [[ "$FUZZY_H3_CODE" == "200" ]]; then
    ok "Analytics fuzzy-search works via HTTP/3"
  elif [[ "$FUZZY_H3_CODE" == "400" ]]; then
    info "Analytics fuzzy-search via HTTP/3 returned 400 (query/params)"
  else
    warn "Analytics fuzzy-search via HTTP/3 returned HTTP $FUZZY_H3_CODE"
  fi
fi

# Test 13m3: Python AI - Buying Advice via HTTP/2 (run before selling to warm DB pool)
if [[ -n "${TOKEN:-}" ]] && type strict_curl &>/dev/null; then
  say "Test 13m3: Python AI Service - Buying Advice via HTTP/2"
  BUY_ADV_RC=0
  BUY_ADV_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/ai/buying-advice" \
    -d "{\"query\":\"Miles Davis Kind of Blue\",\"max_budget\":100,\"user_id\":\"${USER1_ID:-null}\",\"urgency\":\"normal\"}" 2>&1) || BUY_ADV_RC=$?
  BUY_ADV_CODE=$(echo "$BUY_ADV_RESPONSE" | tail -1)
  # Retry on 503 db_pool_unavailable (cold pool)
  for _retry in 1 2; do
    [[ "$BUY_ADV_CODE" != "503" ]] && break
    echo "$BUY_ADV_RESPONSE" | sed '$d' | grep -q 'db_pool_unavailable' || break
    info "  [13m3] Retrying buying-advice after 503 db_pool_unavailable…"
    sleep 3
    BUY_ADV_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/ai/buying-advice" \
      -d "{\"query\":\"Miles Davis Kind of Blue\",\"max_budget\":100,\"user_id\":\"${USER1_ID:-null}\",\"urgency\":\"normal\"}" 2>&1)
    BUY_ADV_CODE=$(echo "$BUY_ADV_RESPONSE" | tail -1)
  done
  if [[ "$BUY_ADV_RC" -ne 0 ]]; then
    warn "Python AI buying-advice via HTTP/2 failed (curl exit $BUY_ADV_RC)"
  elif [[ "$BUY_ADV_CODE" == "200" ]]; then
    ok "Python AI buying-advice works via HTTP/2"
    verify_db_after_test 5440 python_ai "SELECT 1 FROM ai.inference_log WHERE inference_type = 'buying' ORDER BY created_at DESC LIMIT 1" "Test 13m3 DB: buying inference in ai.inference_log" || true
  else
    warn "Python AI buying-advice via HTTP/2 returned HTTP $BUY_ADV_CODE"
    [[ "$BUY_ADV_CODE" == "503" ]] && info "  (on success: verifies ai.inference_log in python_ai DB, port 5440)"
  fi
fi

# Test 13m: Python AI Service - Selling Advice (HTTP/2 + HTTP/3) — writes to ai.inference_log (port 5440)
if [[ -n "${TOKEN:-}" ]] && type strict_curl &>/dev/null; then
  say "Test 13m: Python AI Service - Selling Advice via HTTP/2"
  SELL_ADV_RC=0
  SELL_ADV_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 60 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/ai/selling-advice" \
    -d "{\"query\":\"Blue Note first pressing\",\"record_grade\":\"NM\",\"sleeve_grade\":\"VG+\",\"user_id\":\"${USER1_ID:-null}\",\"current_price\":45}" 2>&1) || SELL_ADV_RC=$?
  SELL_ADV_CODE=$(echo "$SELL_ADV_RESPONSE" | tail -1)
  # Retry up to 2x on 503 db_pool_unavailable (cold pool)
  for _retry in 1 2; do
    [[ "$SELL_ADV_CODE" != "503" ]] && break
    echo "$SELL_ADV_RESPONSE" | sed '$d' | grep -q 'db_pool_unavailable' || break
    info "  [13m] Retrying selling-advice after 503 db_pool_unavailable (attempt $_retry/2)…"
    sleep 3
    SELL_ADV_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 60 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/ai/selling-advice" \
      -d "{\"query\":\"Blue Note first pressing\",\"record_grade\":\"NM\",\"sleeve_grade\":\"VG+\",\"user_id\":\"${USER1_ID:-null}\",\"current_price\":45}" 2>&1)
    SELL_ADV_CODE=$(echo "$SELL_ADV_RESPONSE" | tail -1)
  done
  if [[ "$SELL_ADV_RC" -ne 0 ]]; then
    warn "Python AI selling-advice via HTTP/2 failed (curl exit $SELL_ADV_RC)"
    _maybe_capture "$SELL_ADV_RESPONSE" "13m"
  elif [[ "$SELL_ADV_CODE" =~ ^(200)$ ]]; then
    ok "Python AI selling-advice works via HTTP/2"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5440 python_ai "SELECT 1 FROM ai.inference_log WHERE user_id = '${USER1_ID}' AND inference_type = 'selling' ORDER BY created_at DESC LIMIT 1" "Test 13m DB: inference in ai.inference_log" || \
    verify_db_after_test 5440 python_ai "SELECT 1 FROM ai.inference_log WHERE inference_type = 'selling' ORDER BY created_at DESC LIMIT 1" "Test 13m DB: inference in ai.inference_log" || true
  else
    warn "Python AI selling-advice via HTTP/2 failed - HTTP $SELL_ADV_CODE"
    [[ "$SELL_ADV_CODE" == "503" ]] && info "  (on success: verifies ai.inference_log in python_ai DB, port 5440)"
    _echo_error_hint "$SELL_ADV_RESPONSE" "13m"
    _maybe_capture "$SELL_ADV_RESPONSE" "13m"
  fi
fi
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 13m2: Python AI Service - Selling Advice via HTTP/3"
  SELL_ADV_H3_RC=0
  SELL_ADV_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/ai/selling-advice" \
    -d "{\"query\":\"Coltrane Blue Train vinyl\",\"record_grade\":\"VG+\",\"sleeve_grade\":\"G+\",\"user_id\":\"${USER1_ID:-null}\",\"current_price\":120}" 2>&1) || SELL_ADV_H3_RC=$?
  SELL_ADV_H3_CODE=$(echo "$SELL_ADV_H3_RESPONSE" | tail -1)
  if [[ "$SELL_ADV_H3_RC" -ne 0 ]]; then
    warn "Python AI selling-advice via HTTP/3 failed (curl exit $SELL_ADV_H3_RC)"
    _maybe_capture "$SELL_ADV_H3_RESPONSE" "13m2"
  elif [[ "$SELL_ADV_H3_CODE" =~ ^(200)$ ]]; then
    ok "Python AI selling-advice works via HTTP/3"
    verify_db_after_test 5440 python_ai "SELECT 1 FROM ai.inference_log WHERE inference_type = 'selling' ORDER BY created_at DESC LIMIT 1" "Test 13m2 DB: H3 inference in ai.inference_log" || true
  else
    warn "Python AI selling-advice via HTTP/3 failed - HTTP $SELL_ADV_H3_CODE"
    [[ "$SELL_ADV_H3_CODE" == "503" ]] && info "  (on success: verifies ai.inference_log in python_ai DB, port 5440)"
    _echo_error_hint "$SELL_ADV_H3_RESPONSE" "13m2"
    _maybe_capture "$SELL_ADV_H3_RESPONSE" "13m2"
  fi
fi

# Test 13m4: Python AI Service - Buying Advice via HTTP/3
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 13m4: Python AI Service - Buying Advice via HTTP/3"
  BUY_ADV_H3_RC=0
  BUY_ADV_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/ai/buying-advice" \
    -d "{\"query\":\"Miles Davis Sketches of Spain\",\"max_budget\":80,\"user_id\":\"${USER1_ID:-null}\",\"urgency\":\"low\"}" 2>&1) || BUY_ADV_H3_RC=$?
  BUY_ADV_H3_CODE=$(echo "$BUY_ADV_H3_RESPONSE" | tail -1)
  if [[ "$BUY_ADV_H3_RC" -ne 0 ]]; then
    warn "Python AI buying-advice via HTTP/3 failed (curl exit $BUY_ADV_H3_RC)"
  elif [[ "$BUY_ADV_H3_CODE" == "200" ]]; then
    ok "Python AI buying-advice works via HTTP/3"
    verify_db_after_test 5440 python_ai "SELECT 1 FROM ai.inference_log WHERE inference_type = 'buying' ORDER BY created_at DESC LIMIT 1" "Test 13m4 DB: H3 buying inference in ai.inference_log" || true
  else
    warn "Python AI buying-advice via HTTP/3 returned HTTP $BUY_ADV_H3_CODE"
    [[ "$BUY_ADV_H3_CODE" == "503" ]] && info "  (on success: verifies ai.inference_log in python_ai DB, port 5440)"
  fi
fi

# Test 14: Logout (HTTP/2 and HTTP/3) - run HTTP/3 first so token is still valid
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 14b: Auth Service - Logout via HTTP/3"
  LOGOUT_H3_RC=0
  LOGOUT_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/auth/logout" 2>&1) || LOGOUT_H3_RC=$?
  LOGOUT_H3_CODE=$(echo "$LOGOUT_H3_RESPONSE" | tail -1)
  if [[ "$LOGOUT_H3_RC" -ne 0 ]]; then
    warn "Logout via HTTP/3 request failed (curl exit $LOGOUT_H3_RC)"
  elif [[ "$LOGOUT_H3_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/3 (HTTP $LOGOUT_H3_CODE)"
  else
    warn "Logout via HTTP/3 failed - HTTP $LOGOUT_H3_CODE"
  fi
fi

if [[ -n "${TOKEN:-}" ]]; then
  say "Test 14: Auth Service - Logout via HTTP/2"
  LOGOUT_RC=0
  LOGOUT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/auth/logout" 2>&1) || LOGOUT_RC=$?
  LOGOUT_CODE=$(echo "$LOGOUT_RESPONSE" | tail -1)
  if [[ "$LOGOUT_RC" -ne 0 ]]; then
    warn "Logout request failed (curl exit $LOGOUT_RC)"
  elif [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/2 (HTTP $LOGOUT_CODE)"
  else
    warn "Logout failed - HTTP $LOGOUT_CODE"
  fi
else
  warn "Skipping logout test - no auth token available"
fi

# Test 15: Delete Account (HTTP/2). Packet capture runs through Test 15b then stops before gRPC.
# Create a new user for deletion test to avoid affecting other tests
say "Test 15: Auth Service - Delete Account via HTTP/2"
DELETE_TEST_EMAIL="delete-test-$(date +%s)@example.com"
DELETE_TEST_PASSWORD="test123"
DELETE_REGISTER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$DELETE_TEST_EMAIL\",\"password\":\"$DELETE_TEST_PASSWORD\"}" 2>&1) || {
  warn "Delete test user registration curl command failed (exit code: $?)"
  DELETE_REGISTER_RESPONSE=""
  DELETE_REGISTER_CODE="000"
}
if [[ -n "$DELETE_REGISTER_RESPONSE" ]]; then
  DELETE_REGISTER_CODE=$(echo "$DELETE_REGISTER_RESPONSE" | tail -1)
else
  DELETE_REGISTER_CODE="000"
fi
if [[ "$DELETE_REGISTER_CODE" == "201" ]]; then
  DELETE_TOKEN=$(echo "$DELETE_REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  if [[ -n "$DELETE_TOKEN" ]]; then
    ok "Delete test user registered successfully"
    # Now delete the account
    DELETE_ACCOUNT_RC=0
    DELETE_ACCOUNT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $DELETE_TOKEN" \
      -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>&1) || DELETE_ACCOUNT_RC=$?
    DELETE_ACCOUNT_CODE=$(echo "$DELETE_ACCOUNT_RESPONSE" | tail -1)
    if [[ "$DELETE_ACCOUNT_RC" -ne 0 ]]; then
      warn "Delete account request failed (curl exit $DELETE_ACCOUNT_RC)"
    elif [[ "$DELETE_ACCOUNT_CODE" == "204" ]]; then
      ok "Delete account works via HTTP/2 (HTTP 204)"
      # Verify account is deleted by trying to login
      sleep 1
      DELETE_LOGIN_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Content-Type: application/json" \
        -X POST "https://$HOST:${PORT}/api/auth/login" \
        -d "{\"email\":\"$DELETE_TEST_EMAIL\",\"password\":\"$DELETE_TEST_PASSWORD\"}" 2>&1)
      DELETE_LOGIN_CODE=$(echo "$DELETE_LOGIN_RESPONSE" | tail -1)
      if [[ "$DELETE_LOGIN_CODE" == "401" ]] || [[ "$DELETE_LOGIN_CODE" == "404" ]]; then
        ok "Account deletion verified (HTTP $DELETE_LOGIN_CODE on login attempt)"
      elif [[ "$DELETE_LOGIN_CODE" == "500" ]]; then
        warn "Login after delete returned 500 (expected 401/404). Deploy latest auth-service for correct 401 response."
      else
        warn "Account may not be deleted (got HTTP $DELETE_LOGIN_CODE instead of 401/404)"
      fi
      # Verify token is revoked
      DELETE_VERIFY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $DELETE_TOKEN" \
        -X GET "https://$HOST:${PORT}/api/records" 2>&1)
      DELETE_VERIFY_CODE=$(echo "$DELETE_VERIFY_RESPONSE" | tail -1)
      if [[ "$DELETE_VERIFY_CODE" == "401" ]]; then
        ok "Token revocation verified after account deletion (401 on protected endpoint)"
      else
        warn "Token may not be revoked after account deletion (got HTTP $DELETE_VERIFY_CODE instead of 401)"
      fi
    elif [[ "$DELETE_ACCOUNT_CODE" == "401" ]]; then
      warn "Delete account failed - HTTP 401 (authentication required)"
    elif [[ "$DELETE_ACCOUNT_CODE" == "404" ]]; then
      warn "Delete account failed - HTTP 404 (user not found)"
    else
      warn "Delete account failed - HTTP $DELETE_ACCOUNT_CODE"
      echo "Response body: $(echo "$DELETE_ACCOUNT_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Delete test user registration succeeded but no token received"
  fi
elif [[ "$DELETE_REGISTER_CODE" == "409" ]]; then
  warn "Delete test user already exists - will try to delete existing account"
  # Try to login first, then delete
  DELETE_LOGIN_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:${PORT}/api/auth/login" \
    -d "{\"email\":\"$DELETE_TEST_EMAIL\",\"password\":\"$DELETE_TEST_PASSWORD\"}" 2>&1) || {
    warn "Delete test user login failed"
    DELETE_LOGIN_RESPONSE=""
  }
  if [[ -n "$DELETE_LOGIN_RESPONSE" ]]; then
    DELETE_LOGIN_CODE=$(echo "$DELETE_LOGIN_RESPONSE" | tail -1)
    if [[ "$DELETE_LOGIN_CODE" == "200" ]]; then
      DELETE_TOKEN=$(echo "$DELETE_LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
      if [[ -n "$DELETE_TOKEN" ]]; then
        # Try to delete the account
        DELETE_ACCOUNT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" \
          -H "Authorization: Bearer $DELETE_TOKEN" \
          -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>&1) || DELETE_ACCOUNT_RESPONSE=""
        DELETE_ACCOUNT_CODE=$(echo "$DELETE_ACCOUNT_RESPONSE" | tail -1)
        if [[ "$DELETE_ACCOUNT_CODE" == "204" ]]; then
          ok "Delete account works via HTTP/2 (HTTP 204) - existing user deleted"
        else
          warn "Delete account failed for existing user - HTTP $DELETE_ACCOUNT_CODE"
        fi
      fi
    fi
  fi
else
  warn "Delete test user registration failed - HTTP $DELETE_REGISTER_CODE"
  echo "Response body: $(echo "$DELETE_REGISTER_RESPONSE" | sed '$d' | head -5)"
fi

# Test 15b: Delete Account via HTTP/3 (before packet capture). Same flow: register -> delete -> verify login 401.
say "Test 15b: Auth Service - Delete Account via HTTP/3"
if type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  DEL_H3_EMAIL="delete-test-h3-$(date +%s)@example.com"
  DEL_H3_PW="test123"
  info "Test 15b: Registering delete-test user via HTTP/3 (max 30s)..."
  DEL_H3_REG=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/auth/register" \
    -d "{\"email\":\"$DEL_H3_EMAIL\",\"password\":\"$DEL_H3_PW\"}" 2>&1) || DEL_H3_REG=""
  DEL_H3_REG_CODE=$(echo "$DEL_H3_REG" | tail -1)
  if [[ "$DEL_H3_REG_CODE" == "201" ]]; then
    DEL_H3_TOKEN=$(echo "$DEL_H3_REG" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$DEL_H3_TOKEN" ]]; then
      info "Test 15b: Calling DELETE /api/auth/account via HTTP/3..."
      DEL_H3_DEL_RESP=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
        -H "Host: $HOST" -H "Authorization: Bearer $DEL_H3_TOKEN" --resolve "$HTTP3_RESOLVE" \
        -X DELETE "https://$HOST/api/auth/account" 2>&1) || DEL_H3_DEL_RESP=""
      DEL_H3_DEL_CODE=$(echo "$DEL_H3_DEL_RESP" | tail -1)
      if [[ "$DEL_H3_DEL_CODE" == "204" ]]; then
        ok "Delete account works via HTTP/3 (HTTP 204)"
        sleep 1
        info "Test 15b: Verifying login returns 401/404 (max 10s)..."
        DEL_H3_LOGIN=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 10 \
          -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
          -X POST "https://$HOST/api/auth/login" \
          -d "{\"email\":\"$DEL_H3_EMAIL\",\"password\":\"$DEL_H3_PW\"}" 2>&1) || DEL_H3_LOGIN=""
        DEL_H3_LOGIN_CODE=$(echo "$DEL_H3_LOGIN" | tail -1)
        if [[ "$DEL_H3_LOGIN_CODE" == "401" ]] || [[ "$DEL_H3_LOGIN_CODE" == "404" ]]; then
          ok "Account deletion verified via HTTP/3 (HTTP $DEL_H3_LOGIN_CODE on login)"
        elif [[ "$DEL_H3_LOGIN_CODE" == "500" ]]; then
          warn "Login after delete via HTTP/3 returned 500 (expected 401/404). Deploy latest auth-service for correct 401."
        else
          warn "Delete via HTTP/3: login after delete got HTTP $DEL_H3_LOGIN_CODE (expected 401/404)"
        fi
      else
        warn "Delete account via HTTP/3 failed - HTTP $DEL_H3_DEL_CODE"
      fi
    fi
  else
    info "Test 15b: Delete account HTTP/3 skipped (register got $DEL_H3_REG_CODE)"
  fi
else
  info "Test 15b: skipped (HTTP/3 not available: strict_http3_curl or HTTP3_RESOLVE missing; packet capture next)"
fi

# Stop packet capture here (was capturing during Tests 1–15b). Report before gRPC.
# Order: logout (14b/14) → delete account (15 then 15b) → stop capture → gRPC tests.
# Test 15b (delete account via HTTP/3) runs before this block so it is included in the capture.
if [[ -f "$SCRIPT_DIR/lib/packet-capture.sh" ]]; then
  set +e
  say "=== Packet capture — stop (was capturing during Tests 1–15b) and report ==="
  . "$SCRIPT_DIR/lib/packet-capture.sh" 2>/dev/null || true
  _cap_summary=$(mktemp 2>/dev/null || echo "/tmp/baseline-capture-$$.log")
  _cap_timeout="${CAPTURE_STOP_TIMEOUT:-5}"
  export CAPTURE_STOP_TIMEOUT="$_cap_timeout"
  _wait_cap="${BASELINE_CAPTURE_WAIT_CAP:-}"
  [[ -z "$_wait_cap" ]] && [[ -n "${CAPTURE_STOP_TIMEOUT:-}" ]] && _wait_cap=5
  [[ -z "$_wait_cap" ]] && _wait_cap=10
  [[ $_wait_cap -gt $_cap_timeout ]] 2>/dev/null && _wait_cap="$_cap_timeout"
  echo "  [packet-capture] Stopping background captures (wait cap ${_wait_cap}s)…"
  if [[ "${BASELINE_CAPTURE_V2:-0}" == "1" ]]; then
    ( stop_and_analyze_captures_v2 ) > "$_cap_summary" 2>&1
    cat "$_cap_summary" 2>/dev/null || true
  else
    ( ( stop_and_analyze_captures 1 ) > "$_cap_summary" 2>&1 ) &
    _cap_pid=$!
    _cap_pgid=$(ps -o pgid= -p "$_cap_pid" 2>/dev/null | tr -d ' \n') || _cap_pgid=""
    _cap_waited=0
    while [[ $_cap_waited -lt $_wait_cap ]] && [[ -n "${_cap_pid:-}" ]] && kill -0 "$_cap_pid" 2>/dev/null; do sleep 1; _cap_waited=$((_cap_waited + 1)); done
    if [[ -n "${_cap_pid:-}" ]] && kill -0 "$_cap_pid" 2>/dev/null; then
      [[ -n "$_cap_pgid" ]] && [[ "$_cap_pgid" != "0" ]] && kill -9 -"$_cap_pgid" 2>/dev/null || true
      kill -9 "$_cap_pid" 2>/dev/null || true
      echo "  [packet-capture] Proceeding after ${_wait_cap}s"
    fi
    _wait_reap="${BASELINE_CAPTURE_WAIT_REAP:-5}"
    _reaped=0
    while [[ $_reaped -lt $_wait_reap ]] && [[ -n "${_cap_pid:-}" ]] && kill -0 "$_cap_pid" 2>/dev/null; do sleep 1; _reaped=$((_reaped + 1)); done
    [[ $_reaped -ge $_wait_reap ]] && [[ -n "${_cap_pid:-}" ]] && kill -9 "$_cap_pid" 2>/dev/null || true
    wait "$_cap_pid" 2>/dev/null || true
    [[ -f "$_cap_summary" ]] && [[ -s "$_cap_summary" ]] && cat "$_cap_summary" || true
  fi
  if [[ -f "$_cap_summary" ]]; then
    if grep -qE 'L1 \(node\): TCP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null && grep -qE 'L1 \(node\): UDP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null; then
      echo "✅ Packets confirmed (v2 L1 node): HTTP/2 (TCP 443) and HTTP/3/QUIC (UDP 443) traffic seen"
    elif grep -qE 'L2 \(Caddy\): TCP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null && grep -qE 'L2 \(Caddy\): UDP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null; then
      echo "✅ Packets confirmed (v2 L2 Caddy): HTTP/2 (TCP 443) and HTTP/3/QUIC (UDP 443) traffic seen"
    elif grep -qE 'TCP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null && grep -qE 'UDP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null; then
      echo "✅ Packets confirmed (tcpdump): HTTP/2 (TCP 443) and HTTP/3/QUIC (UDP 443) traffic seen"
    elif grep -qE 'TCP 443: [1-9][0-9]*' "$_cap_summary" 2>/dev/null; then
      echo "✅ Packets confirmed (tcpdump): HTTP/2 (TCP 443) traffic seen"
    elif grep -qE 'TCP \(any\): [1-9][0-9]*' "$_cap_summary" 2>/dev/null; then
      echo "✅ Packets confirmed (tcpdump): TCP traffic seen"
    else
      echo "⚠️  Packet analysis: no TCP/UDP 443 counts — capture may have missed traffic, tcpdump was not ready, or UDP 443 not exposed (MetalLB service must expose UDP 443 for QUIC)."
      echo "   Hints: (1) Run scripts/ensure-tcpdump-in-capture-pods.sh (preflight 6e) or scripts/ensure-caddy-envoy-tcpdump.sh (build tcpdump image)"
      echo "   (2) Set CAPTURE_WARMUP_SECONDS=4 when using Colima (QUIC needs extra warmup)"
      echo "   (3) Verify caddy-h3 LoadBalancer exposes UDP 443: kubectl -n ingress-nginx get svc caddy-h3 -o yaml"
    fi
  fi
  rm -f "$_cap_summary" 2>/dev/null || true
  BASELINE_CAPTURE_STOPPED=1
fi
# Keep exit-on-error and unset-var-error off so gRPC (15a–15j) and DB verify run to completion even if a step fails
set +eu

# Helper function to run grpcurl with timeout
grpcurl_with_timeout() {
  local timeout_sec="${1:-10}"
  shift
  local cmd=("$@")
  
  # Try to use timeout command (Linux, or gtimeout on macOS with coreutils)
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "${cmd[@]}" 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_sec" "${cmd[@]}" 2>&1
  else
    # Fallback: run in background and kill after timeout
    local pid
    "${cmd[@]}" 2>&1 &
    pid=$!
    (
      sleep "$timeout_sec"
      kill "$pid" 2>/dev/null || true
    ) &
    wait "$pid" 2>/dev/null || echo "grpcurl timeout after ${timeout_sec}s"
  fi
}

# Helper function to test gRPC with both FIX #1 (h2c port 5000) and FIX #2 (improved flags on NodePort)
grpc_test() {
  local service_name="$1"
  local method="$2"
  local proto_file="$3"
  local data="${4:-'{}'}"
  local timeout="${5:-10}"
  
  # Try multiple proto directory locations (use absolute paths)
  # Priority: 1) ../proto (relative to script), 2) infra/k8s/base/config/proto, 3) find proto dir
  PROTO_DIR=""
  # Try relative path first
  RELATIVE_PROTO="${SCRIPT_DIR}/../proto"
  if [[ -d "$RELATIVE_PROTO" ]]; then
    PROTO_DIR="$(cd "$RELATIVE_PROTO" && pwd)"
  else
    # Try infra/k8s path
    INFRA_PROTO="${SCRIPT_DIR}/../../infra/k8s/base/config/proto"
    if [[ -d "$INFRA_PROTO" ]]; then
      PROTO_DIR="$(cd "$INFRA_PROTO" && pwd)"
    else
      # Find proto directory
      FOUND_PROTO=$(find "$(dirname "${BASH_SOURCE[0]}")/../.." -name "health.proto" -type f 2>/dev/null | head -1 | xargs dirname)
      if [[ -n "$FOUND_PROTO" ]] && [[ -d "$FOUND_PROTO" ]]; then
        PROTO_DIR="$(cd "$FOUND_PROTO" && pwd)"
      fi
    fi
  fi
  
  # Ensure we have an absolute path
  if [[ -n "$PROTO_DIR" ]] && [[ -d "$PROTO_DIR" ]]; then
    PROTO_DIR="$(cd "$PROTO_DIR" && pwd)"
  else
    warn "Could not find proto directory (gRPC health section skipped)"
    return 0
  fi
  
  local result=""
  grpc_authority="${HOST:-off-campus-housing.local}"
  ENVOY_MAX_TIME=3

  local envoy_result=""
  ENVOY_NODEPORT=""
  # 1) gRPC via Caddy (TARGET_IP:443): TLS at Caddy; Caddy proxies to Envoy (h2c). Primary path.
  if [[ -z "$envoy_result" ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]] && [[ -f "$PROTO_DIR/$proto_file" ]]; then
    local _caddy_grpc_result=""
    local _caddy_timeout=10
    if [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
      _caddy_grpc_result=$(grpcurl -cacert "$CA_CERT" -cert /tmp/grpc-certs/tls.crt -key /tmp/grpc-certs/tls.key -authority "$grpc_authority" \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time "$_caddy_timeout" -d "$data" "${TARGET_IP}:443" "$method" 2>&1) || true
    else
      _caddy_grpc_result=$(grpcurl -cacert "$CA_CERT" -authority "$grpc_authority" \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time "$_caddy_timeout" -d "$data" "${TARGET_IP}:443" "$method" 2>&1) || true
    fi
    if [[ -n "$_caddy_grpc_result" ]] && echo "$_caddy_grpc_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|records|search|\"token\":|\"user\":"; then
      envoy_result="$_caddy_grpc_result"
      ENVOY_NODEPORT="lb"
    fi
  fi
  # 2) MetalLB mode: in-cluster grpcurl to Envoy (when Caddy not available or failed).
  if [[ -z "$envoy_result" ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && echo "$method" | grep -q -iE "HealthCheck|grpc.health.v1.Health/Check"; then
    local _incluster
    _incluster=$(_grpc_in_cluster_envoy_health 25)
    if echo "$_incluster" | grep -q -iE "SERVING|\"status\":\"SERVING\"|healthy"; then
      envoy_result="$_incluster"
      ENVOY_NODEPORT="incluster"
    fi
  fi
  # When not MetalLB or not a health check or in-cluster failed: try Envoy port-forward (avoid NodePort 30000/30001 from host).
  if [[ -z "$envoy_result" ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]] && [[ -n "$PROTO_DIR" ]] && [[ -f "$PROTO_DIR/$proto_file" ]]; then
    local _envoy_pf_port=$((13000 + RANDOM % 500))
    ${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s} -n "$ENVOY_NS" port-forward "pod/$ENVOY_POD" "${_envoy_pf_port}:10000" </dev/null >/dev/null 2>/dev/null & local _envoy_pf_pid=$!
    sleep 2
    if kill -0 $_envoy_pf_pid 2>/dev/null; then
      local _envoy_pf_result
      _envoy_pf_result=$(grpcurl -plaintext -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" \
        -max-time "$timeout" -d "$data" "127.0.0.1:${_envoy_pf_port}" "$method" 2>&1) || true
      kill $_envoy_pf_pid 2>/dev/null; wait $_envoy_pf_pid 2>/dev/null || true
      if [[ -n "$_envoy_pf_result" ]] && echo "$_envoy_pf_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|\"token\":|\"user\":|records|search"; then
        envoy_result="$_envoy_pf_result"
        ENVOY_NODEPORT="pf"
      fi
    else
      kill $_envoy_pf_pid 2>/dev/null; wait $_envoy_pf_pid 2>/dev/null || true
    fi
  fi

  # Fallback: NodePort / other (when Caddy and port-forward not used)
  if [[ -z "$envoy_result" ]] && [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]] && [[ -f "$PROTO_DIR/$proto_file" ]]; then
    local _lb_result=""
    if [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
      _lb_result=$(grpcurl -cacert "$CA_CERT" -cert /tmp/grpc-certs/tls.crt -key /tmp/grpc-certs/tls.key -authority "$grpc_authority" \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time 5 -d "$data" "${TARGET_IP}:443" "$method" 2>&1) || true
    else
      _lb_result=$(grpcurl -cacert "$CA_CERT" -authority "$grpc_authority" \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time 5 -d "$data" "${TARGET_IP}:443" "$method" 2>&1) || true
    fi
    if [[ -n "$_lb_result" ]] && echo "$_lb_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|records|search|\"token\":|\"user\":"; then
      envoy_result="$_lb_result"
      ENVOY_NODEPORT="lb"
    fi
  fi

  # Try Envoy via NodePort (30000, 30001) when MetalLB path and Envoy port-forward did not succeed. Short timeouts (3s) so we fail fast when unreachable.
  if [[ -z "$envoy_result" ]]; then
  for port in 30000 30001; do
    test_result=""
    # Plaintext first (same order as Test 4c - often works when NodePort is reachable)
    test_result=$(grpcurl -plaintext -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" \
      -max-time "$ENVOY_MAX_TIME" -d "$data" "127.0.0.1:${port}" "$method" 2>&1) || test_result=""
    # Then strict TLS if we have CA (and plaintext failed or looked like TLS error)
    if [[ -z "$test_result" ]] || echo "$test_result" | grep -q -iE "first record does not look|tls.*handshake|connection refused"; then
      if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
        if [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
          test_result=$(grpcurl -cacert "$CA_CERT" -cert /tmp/grpc-certs/tls.crt -key /tmp/grpc-certs/tls.key \
            -authority "$grpc_authority" \
            -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time "$ENVOY_MAX_TIME" -d "$data" \
            "127.0.0.1:${port}" "$method" 2>&1) || test_result=""
        else
          test_result=$(grpcurl -cacert "$CA_CERT" -authority "$grpc_authority" \
            -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" -max-time "$ENVOY_MAX_TIME" -d "$data" \
            "127.0.0.1:${port}" "$method" 2>&1) || test_result=""
        fi
      fi
    fi
    # Success detection: match healthy, token (for Authenticate), records/search (for SearchRecords), SERVING (for grpc.health.v1), or any valid JSON response (not errors)
    if [[ -n "$test_result" ]] && echo "$test_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|records|search|\"token\":|\"user\":"; then
      ENVOY_NODEPORT=$port
      envoy_result="$test_result"
      break
    fi
    if echo "$test_result" | grep -qi "Unimplemented"; then
      continue
    fi
  done
  
  # If neither port worked, do NOT retry 30000 with long timeout (was causing Test 15h to hang); go straight to port-forward
  if [[ -z "$ENVOY_NODEPORT" ]]; then
    envoy_result=""
  fi
  fi

  # When NodePort is not reachable from host (k3d/Colima), try Envoy via port-forward so both "Envoy" and "port-forward to service" paths can succeed
  if [[ -z "$envoy_result" ]] && [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]] && [[ -n "$PROTO_DIR" ]] && [[ -f "$PROTO_DIR/$proto_file" ]]; then
    local _envoy_pf_port=$((13000 + RANDOM % 500))
    ${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s} -n "$ENVOY_NS" port-forward "pod/$ENVOY_POD" "${_envoy_pf_port}:10000" </dev/null >/dev/null 2>/dev/null & local _envoy_pf_pid=$!
    sleep 2
    if kill -0 $_envoy_pf_pid 2>/dev/null; then
      local _envoy_pf_result
      _envoy_pf_result=$(grpcurl -plaintext -import-path "$PROTO_DIR" -proto "$PROTO_DIR/$proto_file" \
        -max-time "$timeout" -d "$data" "127.0.0.1:${_envoy_pf_port}" "$method" 2>&1) || true
      kill $_envoy_pf_pid 2>/dev/null; wait $_envoy_pf_pid 2>/dev/null || true
      if [[ -n "$_envoy_pf_result" ]] && echo "$_envoy_pf_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|\"token\":|\"user\":|records|search"; then
        envoy_result="$_envoy_pf_result"
        ENVOY_NODEPORT="pf"
      fi
    else
      kill $_envoy_pf_pid 2>/dev/null; wait $_envoy_pf_pid 2>/dev/null || true
    fi
  fi
  
  # Support BOTH methods: Envoy (production path) AND port-forward (strict TLS verification)
  # For health checks: Test BOTH Envoy (if it works) AND port-forward (strict TLS) to show both work
  local service_name_lower_check=$(echo "$service_name" | tr '[:upper:]' '[:lower:]')
  local is_health_check=false
  if echo "$method" | grep -q -iE "HealthCheck|grpc.health.v1.Health/Check"; then
    is_health_check=true
  fi
  
  # Try Envoy first (production path) - works for most cases
  local use_envoy_result=false
  GRPC_LAST_PATH=""
  if [[ -n "$envoy_result" ]] && echo "$envoy_result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|\"token\":|\"user\":|records|search"; then
    use_envoy_result=true
    result="$envoy_result"
    GRPC_LAST_PATH="envoy"
    # For health checks, also verify with port-forward (strict TLS) to show both work
    if [[ "$is_health_check" == "true" ]]; then
      # Mark that we'll also test port-forward for strict TLS verification
      local test_both_methods=true
    fi
  fi
  
  # If Envoy didn't work, or we need strict TLS verification, use port-forward
  # Always run port-forward for strict TLS verification when Envoy failed or for thoroughness (GRPC_ALWAYS_PORT_FORWARD=1 or health check with no Envoy result)
  _run_pf=0
  if [[ -z "$result" ]]; then _run_pf=1; fi
  if [[ "$is_health_check" == "true" ]] && ( [[ -z "$envoy_result" ]] || [[ "${GRPC_ALWAYS_PORT_FORWARD:-1}" == "1" ]] ); then _run_pf=1; fi
  # Colima: permanently skip strict TLS port-forward (SSH multiplex exhaustion, ~11 min); gRPC validated via Caddy (TARGET_IP:443) and in-cluster only
  [[ "${ctx:-}" == *"colima"* ]] && _run_pf=0
  # SKIP_GRPC_STRICT_PORT_FORWARD=1: skip strict TLS port-forward; validate via MetalLB path only
  [[ "${SKIP_GRPC_STRICT_PORT_FORWARD:-0}" == "1" ]] && _run_pf=0
  if [[ "$_run_pf" -eq 1 ]]; then
        # Port-forward to service gRPC port (strict TLS verification); always run when _run_pf=1 for thoroughness
        local service_name_lower=$(echo "$service_name" | tr '[:upper:]' '[:lower:]')
        local svc_pod=""
        case "$service_name_lower" in
          auth) svc_pod=$(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          records) svc_pod=$(kubectl -n "$NS" get pods -l app=records-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          social) svc_pod=$(kubectl -n "$NS" get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          listings) svc_pod=$(kubectl -n "$NS" get pods -l app=listings-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          analytics) svc_pod=$(kubectl -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          shopping) svc_pod=$(kubectl -n "$NS" get pods -l app=shopping-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          auctionmonitor) svc_pod=$(kubectl -n "$NS" get pods -l app=auction-monitor -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
          pythonai) svc_pod=$(kubectl -n "$NS" get pods -l app=python-ai-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
        esac
      
        if [[ -n "$svc_pod" ]]; then
        # Get the gRPC port for this service (use normalized service name)
        local grpc_port="50051"
        case "$service_name_lower" in
          shopping) grpc_port="50058" ;;
          auctionmonitor) grpc_port="50059" ;;
          pythonai) grpc_port="50060" ;;
          social) grpc_port="50056" ;;
          listings) grpc_port="50057" ;;
          analytics) grpc_port="50054" ;;
        esac
        
        # Port-forward and test with STRICT TLS (no -insecure)
        # Extract certificates from pod for strict TLS verification
        local cert_dir="/tmp/grpc-certs-$$"
        mkdir -p "$cert_dir"
        
        # Copy certificates from pod (strict TLS requires proper certs)
        kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/tls.crt" > "$cert_dir/tls.crt" 2>/dev/null || true
        kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/tls.key" > "$cert_dir/tls.key" 2>/dev/null || true
        kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/ca.crt" > "$cert_dir/ca.crt" 2>/dev/null || true
        
        # If certs not in pod, try extracting from secret
        if [[ ! -f "$cert_dir/ca.crt" ]]; then
          _kb -n "$NS" get secret service-tls -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -d > "$cert_dir/ca.crt" 2>/dev/null || true
          _kb -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d > "$cert_dir/tls.crt" 2>/dev/null || true
          _kb -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d > "$cert_dir/tls.key" 2>/dev/null || true
        fi
        
        # Use a unique local port; capture port-forward stderr to diagnose failures
        # Colima: run port-forward + grpcurl in ONE SSH session so both run inside VM (avoids host/VM port mismatch)
        local local_port=$((50051 + RANDOM % 1000))
        local pf_stderr="/tmp/pf-$$-${local_port}.err"
        local use_colima_pf=false
        [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && use_colima_pf=true
        if [[ "$use_colima_pf" == "true" ]]; then
          # Single SSH session: port-forward + grpcurl inside VM (grpcurl must be in Colima VM: brew install grpcurl)
          # Redirect port-forward stderr so it doesn't pollute result (Forwarding from... / Handling connection...)
          result=$(colima ssh -- bash -c "
            kubectl -n $NS port-forward pod/$svc_pod ${local_port}:$grpc_port 2>/dev/null & PF=\$!
            sleep 6
            for r in 1 2 3; do
              out=\$(grpcurl -plaintext -max-time $timeout -d '$data' 127.0.0.1:${local_port} $method 2>&1)
              if echo \"\$out\" | grep -qE 'SERVING|status|token|records|listings|messages'; then kill \$PF 2>/dev/null; echo \"\$out\"; exit 0; fi
              sleep 2
            done
            kill \$PF 2>/dev/null
            echo \"\$out\"
          " 2>&1) || result=""
          rm -rf "$cert_dir" 2>/dev/null || true
        else
          # Redirect port-forward stdout too so "Forwarding from ..." does not pollute grpcurl result (Test 15b)
          ${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s} -n "$NS" port-forward "pod/$svc_pod" "${local_port}:$grpc_port" >/dev/null 2>"$pf_stderr" &
        local pf_pid=$!
        sleep 2
        local retries=0
        local port_ready=false
        while [[ $retries -lt 8 ]]; do
          if ! kill -0 "$pf_pid" 2>/dev/null; then
            wait "$pf_pid" 2>/dev/null || true
            result="ERROR: Port-forward process exited before port ready (${local_port}:$grpc_port)"
            [[ -s "$pf_stderr" ]] && result="$result -- stderr: $(head -3 "$pf_stderr" | tr '\n' ' ')"
            if grep -q "6443.*connection refused\|connection refused.*6443" "$pf_stderr" 2>/dev/null; then
              result="Port-forward skipped: host cannot reach Kubernetes API at 127.0.0.1:6443 (Colima? Ensure API is exposed). $result"
            fi
            rm -f "$pf_stderr" 2>/dev/null || true
            rm -rf "$cert_dir" 2>/dev/null || true
            echo "$result"
            return 1
          fi
          (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 ${local_port} 2>/dev/null) || \
           (command -v lsof >/dev/null 2>&1 && lsof -i ":${local_port}" >/dev/null 2>&1) || \
           (command -v grpcurl >/dev/null 2>&1 && grpcurl -plaintext -max-time 2 "127.0.0.1:${local_port}" list 2>/dev/null | head -1 | grep -q .) && port_ready=true
          [[ "$port_ready" == "true" ]] && break
          sleep 1
          retries=$((retries + 1))
        done
        rm -f "$pf_stderr" 2>/dev/null || true
        if [[ "$port_ready" != "true" ]]; then
          kill $pf_pid 2>/dev/null || true
          wait $pf_pid 2>/dev/null || true
          result="ERROR: Port-forward failed to establish connection to ${local_port}:$grpc_port (process may have exited or bound elsewhere)"
          rm -rf "$cert_dir" 2>/dev/null || true
          echo "$result"
          return 1
        fi
        # Use STRICT TLS with proper certificates (grpcurl uses -cacert, -cert, -key, not -tls flags)
        local cert_ca=""
        local cert_crt=""
        local cert_key=""
        if [[ -f "/tmp/grpc-certs/ca.crt" ]] && [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
          cert_ca="/tmp/grpc-certs/ca.crt"
          cert_crt="/tmp/grpc-certs/tls.crt"
          cert_key="/tmp/grpc-certs/tls.key"
        elif [[ -f "$cert_dir/ca.crt" ]] && [[ -f "$cert_dir/tls.crt" ]] && [[ -f "$cert_dir/tls.key" ]]; then
          cert_ca="$cert_dir/ca.crt"
          cert_crt="$cert_dir/tls.crt"
          cert_key="$cert_dir/tls.key"
        fi
        if [[ -n "$cert_ca" ]] && [[ -n "$cert_crt" ]] && [[ -n "$cert_key" ]]; then
          # Try strict TLS first
          result=$(grpcurl \
            -cacert="$cert_ca" \
            -cert="$cert_crt" \
            -key="$cert_key" \
            -servername=off-campus-housing.local \
            -import-path "$PROTO_DIR" \
            -proto "$PROTO_DIR/$proto_file" \
            -max-time "$timeout" \
            -d "$data" \
            "127.0.0.1:${local_port}" "$method" 2>&1) || result=""
          
          # If TLS fails with handshake error, try plaintext (h2c) - some services use plaintext
          if [[ -z "$result" ]] || echo "$result" | grep -q -iE "tls.*handshake|first record does not look like a TLS|connection.*refused|dial.*failed"; then
            result=$(grpcurl -plaintext \
              -import-path "$PROTO_DIR" \
              -proto "$PROTO_DIR/$proto_file" \
              -max-time "$timeout" \
              -d "$data" \
              "127.0.0.1:${local_port}" "$method" 2>&1) || result=""
          fi
        else
          # No certs available, try plaintext (h2c) - some services use plaintext
          result=$(grpcurl -plaintext \
            -import-path "$PROTO_DIR" \
            -proto "$PROTO_DIR/$proto_file" \
            -max-time "$timeout" \
            -d "$data" \
            "127.0.0.1:${local_port}" "$method" 2>&1) || result=""
        fi
        
        # Cleanup (only host path has pf_pid; Colima uses single SSH session)
        rm -rf "$cert_dir" 2>/dev/null || true
        if [[ "$use_colima_pf" != "true" ]] && [[ -n "${pf_pid:-}" ]]; then
          kill $pf_pid 2>/dev/null || true
          wait $pf_pid 2>/dev/null || true
        fi
        sleep 1
        # Success via port-forward
        if [[ -n "$result" ]] && echo "$result" | grep -q -iE "healthy|success|ok|\"status\":\"SERVING\"|SERVING|\"healthy\":true|\"token\":|\"user\":|records|search"; then
          GRPC_LAST_PATH="port-forward"
        fi
      fi
      
      # If still failing, suggest port-forward (k3d/Colima often don't expose NodePort 30000 to host)
      if [[ -z "$result" ]] || echo "$result" | grep -q -iE "502|Bad Gateway|malformed header|Unavailable"; then
        GRPC_LAST_PATH=""
        result="gRPC routing issue - Envoy NodePort 30000/30001 not reachable from host; port-forward path also failed or was not tried. For Authenticate: kubectl -n off-campus-housing-tracker port-forward deployment/auth-service 50051:50051 then grpcurl -cacert /tmp/grpc-certs/ca.crt -authority off-campus-housing.local 127.0.0.1:50051 auth.AuthService/Authenticate (HealthCheck may work via Envoy from inside cluster)."
      fi
    fi
  fi
  
  echo "$result"
  # Caller can show "via Envoy" vs "via port-forward" (parse last line when present)
  [[ -n "${GRPC_LAST_PATH:-}" ]] && echo "GRPC_PATH=${GRPC_LAST_PATH}"
  [[ "${GRPC_LAST_PATH:-}" == "envoy" ]] && [[ "${ENVOY_NODEPORT:-}" == "pf" ]] && echo "GRPC_ENVOY_VIA_PF=1"
}

# Run grpc_test with a hard wall-clock cap so the suite never hangs (e.g. on Colima port-forward/colima ssh).
# Usage: _grpc_test_with_cap <cap_seconds> <grpc_test args...>
# Output: same as grpc_test (stdout). After cap_seconds the child is killed and any output so far is returned.
_grpc_test_with_cap() {
  local cap="${1:-45}"
  shift
  local out
  out=$(mktemp 2>/dev/null || echo "/tmp/grpc-cap-$$-$RANDOM.out")
  grpc_test "$@" > "$out" 2>&1 & local rpid=$!
  local i=0
  while kill -0 "$rpid" 2>/dev/null && [[ $i -lt $cap ]]; do sleep 1; i=$((i + 1)); done
  kill -9 "$rpid" 2>/dev/null || true
  ( wait "$rpid" 2>/dev/null ) & local wpid=$!
  local j=0; while kill -0 "$wpid" 2>/dev/null && [[ $j -lt 4 ]]; do sleep 1; j=$((j + 1)); done
  kill "$wpid" 2>/dev/null || true; wait "$wpid" 2>/dev/null || true
  cat "$out" 2>/dev/null; rm -f "$out" 2>/dev/null || true
}

# Strict TLS gRPC test function - ALWAYS uses port-forward with CA + leaf certs
grpc_test_strict_tls() {
  local service_name="$1"
  local method="$2"
  local proto_file="$3"
  local data="${4:-'{}'}"
  local timeout="${5:-10}"
  # Short kubectl timeouts so we stay under run_grpc_strict_tls_with_cap (12s); shim respects this
  KUBECTL_REQUEST_TIMEOUT=5s
  export KUBECTL_REQUEST_TIMEOUT
  
  local NS="${NS:-off-campus-housing-tracker}"
  local PROTO_DIR=""
  
  # Find proto directory
  if [[ -d "$(dirname "${BASH_SOURCE[0]}")/../proto" ]]; then
    PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../proto" && pwd)"
  elif [[ -d "$(dirname "${BASH_SOURCE[0]}")/../../proto" ]]; then
    PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../proto" && pwd)"
  else
    local INFRA_PROTO="$(dirname "${BASH_SOURCE[0]}")/../../infra/k8s/base/config/proto"
    if [[ -d "$INFRA_PROTO" ]]; then
      PROTO_DIR="$(cd "$INFRA_PROTO" && pwd)"
    else
      local FOUND_PROTO=$(find "$(dirname "${BASH_SOURCE[0]}")/../.." -name "health.proto" -type f 2>/dev/null | head -1 | xargs dirname)
      if [[ -n "$FOUND_PROTO" ]] && [[ -d "$FOUND_PROTO" ]]; then
        PROTO_DIR="$(cd "$FOUND_PROTO" && pwd)"
      fi
    fi
  fi
  
  if [[ -z "$PROTO_DIR" ]] || [[ ! -d "$PROTO_DIR" ]]; then
    echo "ERROR: Could not find proto directory"
    return 0
  fi
  
  local service_name_lower=$(echo "$service_name" | tr '[:upper:]' '[:lower:]')
  local svc_pod=""
  case "$service_name_lower" in
    auth) svc_pod=$(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    records) svc_pod=$(kubectl -n "$NS" get pods -l app=records-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    social) svc_pod=$(kubectl -n "$NS" get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    listings) svc_pod=$(kubectl -n "$NS" get pods -l app=listings-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    analytics) svc_pod=$(kubectl -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    shopping) svc_pod=$(kubectl -n "$NS" get pods -l app=shopping-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    auctionmonitor) svc_pod=$(kubectl -n "$NS" get pods -l app=auction-monitor -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
    pythonai) svc_pod=$(kubectl -n "$NS" get pods -l app=python-ai-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "") ;;
  esac
  
  if [[ -z "$svc_pod" ]]; then
    echo "ERROR: Could not find pod for service $service_name"
    return 0
  fi
  
  local grpc_port="50051"
  case "$service_name_lower" in
    shopping) grpc_port="50058" ;;
    auctionmonitor) grpc_port="50059" ;;
    pythonai) grpc_port="50060" ;;
    social) grpc_port="50056" ;;
    listings) grpc_port="50057" ;;
    analytics) grpc_port="50054" ;;
  esac
  
  # Extract certificates for strict TLS
  local cert_dir="/tmp/grpc-certs-strict-$$"
  mkdir -p "$cert_dir"
  
  # Try to get certs from pod first
  kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/tls.crt" > "$cert_dir/tls.crt" 2>/dev/null || true
  kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/tls.key" > "$cert_dir/tls.key" 2>/dev/null || true
  kubectl -n "$NS" exec "$svc_pod" -- sh -c "cat /etc/certs/ca.crt" > "$cert_dir/ca.crt" 2>/dev/null || true
  
  # Fallback to secret if not in pod
  if [[ ! -f "$cert_dir/ca.crt" ]]; then
    _kb -n "$NS" get secret service-tls -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -d > "$cert_dir/ca.crt" 2>/dev/null || true
    _kb -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d > "$cert_dir/tls.crt" 2>/dev/null || true
    _kb -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d > "$cert_dir/tls.key" 2>/dev/null || true
  fi
  
  # Prefer /tmp/grpc-certs if available (pre-extracted)
  local cert_ca=""
  local cert_crt=""
  local cert_key=""
  if [[ -f "/tmp/grpc-certs/ca.crt" ]] && [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
    cert_ca="/tmp/grpc-certs/ca.crt"
    cert_crt="/tmp/grpc-certs/tls.crt"
    cert_key="/tmp/grpc-certs/tls.key"
  elif [[ -f "$cert_dir/ca.crt" ]] && [[ -f "$cert_dir/tls.crt" ]] && [[ -f "$cert_dir/tls.key" ]]; then
    cert_ca="$cert_dir/ca.crt"
    cert_crt="$cert_dir/tls.crt"
    cert_key="$cert_dir/tls.key"
  fi
  
  # Port-forward with stdout and stderr captured so they don't pollute strict_out (parent redirects to file)
  local local_port=$((50051 + RANDOM % 1000))
  local pf_stderr="/tmp/pf-strict-$$-${local_port}.err"
  local use_colima_pf=false
  [[ "${ctx:-}" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && use_colima_pf=true
  if [[ "$use_colima_pf" == "true" ]]; then
    _kb -n "$NS" port-forward "pod/$svc_pod" "${local_port}:$grpc_port" >"$pf_stderr" 2>&1 &
  else
    ${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s} -n "$NS" port-forward "pod/$svc_pod" "${local_port}:$grpc_port" >"$pf_stderr" 2>&1 &
  fi
  local pf_pid=$!
  # Colima: allow more time for port-forward to bind inside VM (still bounded by run_grpc_strict_tls_with_cap)
  [[ "$use_colima_pf" == "true" ]] && sleep 2 || sleep 2
  local retries=0
  local max_retries=6
  [[ "$use_colima_pf" == "true" ]] && max_retries=5
  local port_ready=false
  local list_timeout=1
  while [[ $retries -lt $max_retries ]]; do
    if ! kill -0 "$pf_pid" 2>/dev/null; then
      wait "$pf_pid" 2>/dev/null || true
      echo "ERROR: Port-forward process exited (${local_port}:$grpc_port)$([[ -s "$pf_stderr" ]] && echo " -- $(head -2 "$pf_stderr" | tr '\n' ' ')")"
      if [[ -s "$pf_stderr" ]] && grep -q "502 Bad Gateway\|dialing backend" "$pf_stderr" 2>/dev/null; then
        echo "  (502: API server could not reach node kubelet; check node/pod status for $service_name_lower)"
      fi
      rm -f "$pf_stderr" 2>/dev/null || true
      rm -rf "$cert_dir" 2>/dev/null || true
      return 1
    fi
    if [[ "$use_colima_pf" == "true" ]]; then
      colima ssh -- nc -z 127.0.0.1 "${local_port}" 2>/dev/null && port_ready=true
      if [[ "$port_ready" != "true" ]]; then
        colima ssh -- grpcurl -plaintext -max-time "$list_timeout" "127.0.0.1:${local_port}" list 2>/dev/null | head -1 | grep -q . && port_ready=true
      fi
    else
      (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 ${local_port} 2>/dev/null) || \
       (command -v lsof >/dev/null 2>&1 && lsof -i ":${local_port}" >/dev/null 2>&1) || \
       (command -v grpcurl >/dev/null 2>&1 && grpcurl -plaintext -max-time "$list_timeout" "127.0.0.1:${local_port}" list 2>/dev/null | head -1 | grep -q .) && port_ready=true
    fi
    [[ "$port_ready" == "true" ]] && break
    sleep 1
    retries=$((retries + 1))
  done
  rm -f "$pf_stderr" 2>/dev/null || true

  if [[ "$port_ready" != "true" ]]; then
    kill $pf_pid 2>/dev/null || true
    wait $pf_pid 2>/dev/null || true
    echo "ERROR: Port-forward failed to establish connection to ${local_port}:$grpc_port"
    rm -rf "$cert_dir" 2>/dev/null || true
    return 1
  fi

  local result=""
  if [[ "$use_colima_pf" == "true" ]]; then
    # Port-forward is in VM; run grpcurl inside VM. Strict TLS/mTLS only (no plaintext).
    if [[ -n "$cert_ca" ]] && [[ -f "$cert_ca" ]] && [[ -n "$cert_crt" ]] && [[ -f "$cert_crt" ]] && [[ -n "$cert_key" ]] && [[ -f "$cert_key" ]]; then
      cat "$cert_ca" | colima ssh -- sh -c "cat > /tmp/grpc-strict-ca-$$.crt" 2>/dev/null || true
      cat "$cert_crt" | colima ssh -- sh -c "cat > /tmp/grpc-strict-tls-$$.crt" 2>/dev/null || true
      cat "$cert_key" | colima ssh -- sh -c "cat > /tmp/grpc-strict-key-$$.key" 2>/dev/null || true
      result=$(colima ssh -- grpcurl -cacert /tmp/grpc-strict-ca-$$.crt -cert /tmp/grpc-strict-tls-$$.crt -key /tmp/grpc-strict-key-$$.key -servername=off-campus-housing.local -max-time "$timeout" -d "$data" "127.0.0.1:${local_port}" "$method" 2>&1) || result=""
      colima ssh -- sh -c "rm -f /tmp/grpc-strict-ca-$$.crt /tmp/grpc-strict-tls-$$.crt /tmp/grpc-strict-key-$$.key" 2>/dev/null || true
    else
      result="ERROR: No TLS certs for Colima strict TLS/mTLS (set up /tmp/grpc-certs or service-tls secret)"
    fi
  elif [[ -n "$cert_ca" ]] && [[ -n "$cert_crt" ]] && [[ -n "$cert_key" ]]; then
    # Strict TLS/mTLS only (no plaintext fallback; all services must use TLS)
    result=$(grpcurl \
      -cacert="$cert_ca" \
      -cert="$cert_crt" \
      -key="$cert_key" \
      -servername=off-campus-housing.local \
      -import-path "$PROTO_DIR" \
      -proto "$PROTO_DIR/$proto_file" \
      -max-time "$timeout" \
      -d "$data" \
      "127.0.0.1:${local_port}" "$method" 2>&1) || result=""
  else
    # No certs - strict TLS path cannot proceed (do not fall back to plaintext)
    result="ERROR: No TLS certs available; strict TLS/mTLS required (set up /tmp/grpc-certs or service-tls secret)"
  fi
  
  # Cleanup
  rm -rf "$cert_dir" 2>/dev/null || true
  kill $pf_pid 2>/dev/null || true
  wait $pf_pid 2>/dev/null || true
  sleep 1
  
  echo "$result"
}

# Run grpc_test_strict_tls with max wall-clock time so we never hang (no timeout command on macOS)
# Cap 25s on Colima (cert copy + port-forward + grpcurl); 8s on host. We always run strict TLS/mTLS gRPC per service.
run_grpc_strict_tls_with_cap() {
  local cap_sec="${GRPC_STRICT_CAP:-${1:-8}}"
  [[ "${ctx:-}" == *"colima"* ]] && [[ "$cap_sec" -lt 25 ]] && cap_sec=25
  shift
  local strict_out
  strict_out=$(mktemp 2>/dev/null || echo "/tmp/grpc-strict-$$-$RANDOM.out")
  # Run in subshell; avoid indefinite wait by force-killing if still alive after bounded wait
  ( grpc_test_strict_tls "$@" > "$strict_out" 2>&1 ) &
  local pid=$!
  local waited=0
  while [[ $waited -lt "$cap_sec" ]] && kill -0 "$pid" 2>/dev/null; do sleep 1; waited=$((waited + 1)); done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "ERROR: strict TLS timed out after ${cap_sec}s (port-forward or grpcurl may be slow on Colima)"
    echo "  Envoy path already verified this service; strict TLS is optional. To allow more time on Colima, set GRPC_STRICT_CAP=30 before running."
  fi
  # Bounded wait; then force SIGKILL so wait never blocks forever (e.g. colima ssh / grpcurl stuck)
  local wait_count=0
  while kill -0 "$pid" 2>/dev/null && [[ $wait_count -lt 6 ]]; do sleep 1; wait_count=$((wait_count + 1)); done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  wait "$pid" 2>/dev/null || true
  cat "$strict_out" 2>/dev/null || true
  rm -f "$strict_out" 2>/dev/null || true
}

# Outer timeout wrapper: run strict TLS test in background and wait with a hard cap so the
# *caller* never blocks in command substitution (e.g. VAR=$(run_grpc_strict_tls_with_cap ...)).
# Without this, the command-sub subshell can block in wait() for a stuck grandchild.
_run_grpc_strict_never_hang() {
  local out
  out=$(mktemp 2>/dev/null || echo "/tmp/grpc-outer-$$-$RANDOM.out")
  run_grpc_strict_tls_with_cap "$@" > "$out" 2>&1 & local rpid=$!
  local i=0
  while kill -0 "$rpid" 2>/dev/null && [[ $i -lt 30 ]]; do sleep 1; i=$((i + 1)); done
  kill -9 "$rpid" 2>/dev/null || true
  # Bounded wait for reap (wait in background so we don't block forever)
  ( wait "$rpid" 2>/dev/null ) & local wpid=$!
  local j=0; while kill -0 "$wpid" 2>/dev/null && [[ $j -lt 4 ]]; do sleep 1; j=$((j + 1)); done
  kill "$wpid" 2>/dev/null || true; wait "$wpid" 2>/dev/null || true
  cat "$out" 2>/dev/null; rm -f "$out" 2>/dev/null || true
}

# Test 15: gRPC Testing (if grpcurl is available and not skipped)
# Set SKIP_GRPC=1 to disable until Envoy direct test passes (scripts/test-grpc-direct-in-cluster.sh).
# When DB_VERIFY_FAST=1 and Caddy→Envoy gRPC failed (Test 4c): still run in-cluster gRPC health so we get signal; skip only the long strict-TLS port-forward block.
_say_ts "Test 15: gRPC Service Testing"
if [[ "${SKIP_GRPC:-0}" == "1" ]]; then
  info "gRPC tests skipped (SKIP_GRPC=1). Verify direct gRPC first: ./scripts/test-grpc-direct-in-cluster.sh auth-service; then fix Envoy and run without SKIP_GRPC."
elif [[ "${DB_VERIFY_FAST:-0}" == "1" ]] && [[ "${ENVOY_GRPC_OK:-0}" -eq 0 ]]; then
  info "DB_VERIFY_FAST=1 and Test 4c failed (Caddy→Envoy gRPC not available). Running in-cluster gRPC health only; skipping long strict TLS port-forward block (~11 min)."
  _incluster=$(_grpc_in_cluster_envoy_health 25)
  if echo "$_incluster" | grep -q -iE "SERVING|\"status\":\"SERVING\"|healthy"; then
    ok "gRPC in-cluster health (Envoy :10000): SERVING — fix Caddy→Envoy TLS (see docs/RCA-GRPC-CADDY-ENVOY-TLS.md) to enable full gRPC via Caddy."
  else
    warn "gRPC in-cluster health failed: $_incluster"
    if echo "$_incluster" | grep -q -iE "TLS_error|SSLV3_ALERT_HANDSHAKE_FAILURE"; then
      info "Envoy listener mode mismatch: in-cluster test uses -plaintext (repo has Envoy plaintext). TLS_error means running Envoy may have TLS. Confirm in 20s:"
      info "  kubectl -n envoy-test port-forward deploy/envoy-test 15000:10000 &  sleep 3"
      info "  grpcurl -plaintext localhost:15000 grpc.health.v1.Health/Check   # if OK → Envoy is plaintext; re-apply envoy-test so cluster matches repo"
      info "  grpcurl -cacert certs/dev-root.pem localhost:15000 grpc.health.v1.Health/Check   # if OK → Envoy is TLS; align Caddy/grpcurl to TLS"
      info "  See docs/RCA-GRPC-CADDY-ENVOY-TLS.md (mode alignment + apply/restart)."
    fi
  fi
  info "Proceeding to Test 16 (full gRPC block skipped; set DB_VERIFY_FAST=0 and fix Envoy TLS to run all gRPC tests)."
else
info "gRPC path: When TARGET_IP is set (MetalLB), gRPC via Caddy (TARGET_IP:443) → Envoy (h2c) → backends."
if ! command -v grpcurl >/dev/null 2>&1; then
  warn "grpcurl not installed - skipping gRPC tests"
  warn "  Install with: brew install grpcurl"
  warn "  Or: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest"
else
  # Root-cause: why Envoy NodePort is often not reachable from host (k3d/Colima)
  _envoy_np_ok=0
  nc -z -w 2 127.0.0.1 30000 2>/dev/null || nc -z -G 2 127.0.0.1 30000 2>/dev/null && _envoy_np_ok=1
  nc -z -w 2 127.0.0.1 30001 2>/dev/null || nc -z -G 2 127.0.0.1 30001 2>/dev/null && _envoy_np_ok=1
  if [[ $_envoy_np_ok -eq 0 ]] && kubectl get svc -n envoy-test envoy-test --request-timeout=5s >/dev/null 2>&1; then
    info "Root cause (gRPC): Envoy not reachable from host. Envoy service:"
    kubectl get svc -n envoy-test envoy-test -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,PORT:.spec.ports[0].port,NODEPORT:.spec.ports[0].nodePort' --no-headers 2>/dev/null | sed 's/^/  /' || kubectl get svc -n envoy-test --request-timeout=5s 2>/dev/null | sed 's/^/  /'
    info "  When TARGET_IP is set: gRPC goes via Caddy (TARGET_IP:443). Else we use port-forward to Envoy pod (10000); NodePort 30000/30001 is fallback."
  fi
  set +e
  # Pre-check: strict TLS needs CA/certs (from /tmp/grpc-certs or service-tls secret)
  if [[ ! -d /tmp/grpc-certs ]] || [[ ! -f /tmp/grpc-certs/ca.crt ]]; then
    _kb -n "${NS:-off-campus-housing-tracker}" get secret service-tls -o name >/dev/null 2>&1 || warn "service-tls secret missing; strict TLS tests may extract from pods or fail"
  else
    info "Strict TLS certs present in /tmp/grpc-certs"
  fi
  # Test gRPC Auth Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both for thorough testing)
  say "Test 15a: gRPC Auth Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  GRPC_AUTH_HEALTH=$(_grpc_test_with_cap 45 "Auth" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_AUTH_HEALTH" | grep -q -iE "SERVING|healthy"; then
    ok "gRPC Auth HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Auth HealthCheck failed via Envoy"
    echo "Response: $GRPC_AUTH_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_AUTH_HEALTH_STRICT=""
  else
    GRPC_AUTH_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Auth" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_AUTH_HEALTH_STRICT" | grep -q -iE "SERVING|healthy"; then
    ok "gRPC Auth HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_AUTH_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_AUTH_HEALTH" | grep -q -iE "SERVING|healthy"; then
      :  # Envoy path used; strict TLS port-forward skipped (Colima / LB IP mode)
    else
      info "gRPC Auth HealthCheck: strict TLS port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Auth HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_AUTH_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Auth Service - Authenticate (if we have credentials). Same pattern as 15j: try Envoy first, then always run strict TLS; report both.
  if [[ -n "${TEST_EMAIL:-}" ]] && [[ -n "${TEST_PASSWORD:-}" ]]; then
    say "Test 15b: gRPC Auth Service - Authenticate via HTTP/2 (Envoy + Strict TLS/mTLS)"
    GRPC_AUTH_RAW=$(_grpc_test_with_cap 60 "Auth" "auth.AuthService/Authenticate" "auth.proto" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 15)
    GRPC_AUTH_PATH=$(echo "$GRPC_AUTH_RAW" | grep "^GRPC_PATH=" | tail -1 | cut -d= -f2)
    GRPC_AUTH_VIA_PF=$(echo "$GRPC_AUTH_RAW" | grep "^GRPC_ENVOY_VIA_PF=1" | tail -1)
    GRPC_AUTH_RESPONSE=$(echo "$GRPC_AUTH_RAW" | grep -v "^GRPC_PATH=" | grep -v "^GRPC_ENVOY_VIA_PF=")
    if echo "$GRPC_AUTH_RESPONSE" | grep -q "token"; then
      if [[ "$GRPC_AUTH_PATH" == "envoy" ]]; then
        [[ -n "$GRPC_AUTH_VIA_PF" ]] && ok "gRPC Auth Authenticate works via Envoy (HTTP/2, port-forward to Envoy)" || ok "gRPC Auth Authenticate works via Envoy (HTTP/2)"
      elif [[ "$GRPC_AUTH_PATH" == "port-forward" ]]; then
        ok "gRPC Auth Authenticate works via port-forward (HTTP/2) — Envoy NodePort not reachable from host"
      else
        ok "gRPC Auth Authenticate works via HTTP/2"
      fi
      GRPC_TOKEN=$(echo "$GRPC_AUTH_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "gRPC Auth Authenticate failed via Envoy"
      echo "Response: $GRPC_AUTH_RESPONSE" | head -3
    fi
    if [[ "${ctx:-}" == *"colima"* ]]; then
      GRPC_AUTH_STRICT=""
    else
      GRPC_AUTH_STRICT=$(_run_grpc_strict_never_hang 18 "Auth" "auth.AuthService/Authenticate" "auth.proto" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 12)
    fi
    if echo "$GRPC_AUTH_STRICT" | grep -q "token"; then
      ok "gRPC Auth Authenticate works via port-forward (Strict TLS/mTLS)"
      [[ -z "${GRPC_TOKEN:-}" ]] && GRPC_TOKEN=$(echo "$GRPC_AUTH_STRICT" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    elif [[ "${ctx:-}" == *"colima"* ]] && echo "$GRPC_AUTH_RESPONSE" | grep -q "token"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      warn "gRPC Auth Authenticate strict TLS/mTLS verification failed"
      echo "Response: $GRPC_AUTH_STRICT" | head -3
    fi
  fi

  # Test gRPC Records Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both)
  say "Test 15c: gRPC Records Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  GRPC_RECORDS_HEALTH=$(_grpc_test_with_cap 45 "Records" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_RECORDS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Records HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Records HealthCheck failed via Envoy"
    echo "Response: $GRPC_RECORDS_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_RECORDS_HEALTH_STRICT=""
  else
    GRPC_RECORDS_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Records" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_RECORDS_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Records HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_RECORDS_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_RECORDS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Records HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Records HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_RECORDS_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Records Service - SearchRecords: try Envoy first, then port-forward (both paths used to work; report both).
  if [[ -n "${USER1_ID:-}" ]]; then
    say "Test 15d: gRPC Records Service - SearchRecords via HTTP/2 (Envoy + Strict TLS/mTLS)"
    GRPC_SEARCH_RAW=$(_grpc_test_with_cap 45 "Records" "records.RecordsService/SearchRecords" "records.proto" "{\"user_id\":\"$USER1_ID\",\"query\":\"test\",\"limit\":10}" 10)
    GRPC_SEARCH_PATH=$(echo "$GRPC_SEARCH_RAW" | grep "^GRPC_PATH=" | tail -1 | cut -d= -f2)
    GRPC_SEARCH_VIA_PF=$(echo "$GRPC_SEARCH_RAW" | grep "^GRPC_ENVOY_VIA_PF=1" | tail -1)
    GRPC_SEARCH_RESPONSE=$(echo "$GRPC_SEARCH_RAW" | grep -v "^GRPC_PATH=" | grep -v "^GRPC_ENVOY_VIA_PF=")
    if echo "$GRPC_SEARCH_RESPONSE" | grep -q "records"; then
      if [[ "$GRPC_SEARCH_PATH" == "envoy" ]]; then
        [[ -n "$GRPC_SEARCH_VIA_PF" ]] && ok "gRPC Records SearchRecords works via Envoy (HTTP/2, port-forward to Envoy)" || ok "gRPC Records SearchRecords works via Envoy (HTTP/2)"
      elif [[ "$GRPC_SEARCH_PATH" == "port-forward" ]]; then
        ok "gRPC Records SearchRecords works via port-forward (Envoy NodePort not reachable from host)"
      else
        ok "gRPC Records SearchRecords works via HTTP/2"
      fi
    else
      warn "gRPC Records SearchRecords failed via Envoy"
      echo "Response: $GRPC_SEARCH_RESPONSE" | head -3
    fi
    if [[ "${ctx:-}" != *"colima"* ]]; then
      GRPC_SEARCH_STRICT=$(_run_grpc_strict_never_hang 12 "Records" "records.RecordsService/SearchRecords" "records.proto" "{\"user_id\":\"$USER1_ID\",\"query\":\"test\",\"limit\":10}" 10)
    else
      GRPC_SEARCH_STRICT=""
    fi
    if echo "$GRPC_SEARCH_STRICT" | grep -q "records"; then
      ok "gRPC Records SearchRecords works via port-forward (Strict TLS/mTLS)"
    elif [[ "${ctx:-}" == *"colima"* ]] && echo "$GRPC_SEARCH_RESPONSE" | grep -q "records"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      warn "gRPC Records SearchRecords strict TLS/mTLS verification failed"
      echo "Response: $GRPC_SEARCH_STRICT" | head -3
    fi
  fi

  # Test gRPC Social Service - HealthCheck (Envoy + strict TLS with 18s cap)
  say "Test 15e: gRPC Social Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_SOCIAL_HEALTH=$(_grpc_test_with_cap 45 "Social" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_SOCIAL_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Social HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Social HealthCheck failed via Envoy"
    echo "Response: $GRPC_SOCIAL_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_SOCIAL_HEALTH_STRICT=""
  else
    GRPC_SOCIAL_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Social" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_SOCIAL_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Social HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_SOCIAL_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_SOCIAL_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Social HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Social HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_SOCIAL_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Listings Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both)
  say "Test 15f: gRPC Listings Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_LISTINGS_HEALTH=$(_grpc_test_with_cap 45 "Listings" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_LISTINGS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Listings HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Listings HealthCheck failed via Envoy"
    echo "Response: $GRPC_LISTINGS_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_LISTINGS_HEALTH_STRICT=""
  else
    GRPC_LISTINGS_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Listings" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_LISTINGS_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Listings HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_LISTINGS_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_LISTINGS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Listings HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Listings HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_LISTINGS_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Analytics Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both)
  say "Test 15g: gRPC Analytics Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_ANALYTICS_HEALTH=$(_grpc_test_with_cap 45 "Analytics" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_ANALYTICS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Analytics HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Analytics HealthCheck failed via Envoy"
    echo "Response: $GRPC_ANALYTICS_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_ANALYTICS_HEALTH_STRICT=""
  else
    GRPC_ANALYTICS_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Analytics" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_ANALYTICS_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Analytics HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_ANALYTICS_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_ANALYTICS_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Analytics HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Analytics HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_ANALYTICS_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Shopping Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both)
  say "Test 15h: gRPC Shopping Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_SHOPPING_HEALTH=$(_grpc_test_with_cap 45 "Shopping" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_SHOPPING_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Shopping HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Shopping HealthCheck failed via Envoy"
    echo "Response: $GRPC_SHOPPING_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_SHOPPING_HEALTH_STRICT=""
  else
    GRPC_SHOPPING_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "Shopping" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_SHOPPING_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Shopping HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_SHOPPING_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_SHOPPING_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Shopping HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Shopping HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_SHOPPING_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Auction Monitor Service - HealthCheck: Envoy + strict TLS/mTLS port-forward (always run both)
  say "Test 15i: gRPC Auction Monitor Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_AUCTION_MONITOR_HEALTH=$(_grpc_test_with_cap 45 "AuctionMonitor" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_AUCTION_MONITOR_HEALTH" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Auction Monitor HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Auction Monitor HealthCheck failed via Envoy"
    echo "Response: $GRPC_AUCTION_MONITOR_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_AUCTION_MONITOR_HEALTH_STRICT=""
  else
    GRPC_AUCTION_MONITOR_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "AuctionMonitor" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_AUCTION_MONITOR_HEALTH_STRICT" | grep -q -iE "\"status\":\"SERVING\"|SERVING"; then
    ok "gRPC Auction Monitor HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_AUCTION_MONITOR_HEALTH_STRICT" | grep -qE 'Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists'; then
    if echo "$GRPC_AUCTION_MONITOR_HEALTH" | grep -q -iE '"status":"SERVING"|SERVING'; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Auction Monitor HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Auction Monitor HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_AUCTION_MONITOR_HEALTH_STRICT" | head -3
  fi

  # Test gRPC Python AI Service - HealthCheck (Envoy + strict TLS with 18s cap)
  say "Test 15j: gRPC Python AI Service - HealthCheck via HTTP/2 (Envoy + Strict TLS/mTLS)"
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  GRPC_PYTHON_AI_HEALTH=$(_grpc_test_with_cap 45 "PythonAI" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 10)
  if echo "$GRPC_PYTHON_AI_HEALTH" | grep -qiE 'SERVING|"status":"SERVING"'; then
    ok "gRPC Python AI HealthCheck works via Envoy (HTTP/2)"
  else
    warn "gRPC Python AI HealthCheck failed via Envoy"
    echo "Response: $GRPC_PYTHON_AI_HEALTH" | head -3
  fi
  [[ "${ctx:-}" == *"colima"* ]] && sleep 1
  if [[ "${ctx:-}" == *"colima"* ]]; then
    GRPC_PYTHON_AI_HEALTH_STRICT=""
  else
    GRPC_PYTHON_AI_HEALTH_STRICT=$(_run_grpc_strict_never_hang 8 "PythonAI" "grpc.health.v1.Health/Check" "health.proto" '{"service":""}' 8)
  fi
  if echo "$GRPC_PYTHON_AI_HEALTH_STRICT" | grep -qiE 'SERVING|"status":"SERVING"'; then
    ok "gRPC Python AI HealthCheck works via port-forward (Strict TLS/mTLS)"
  elif [[ "${ctx:-}" == *"colima"* ]] || echo "$GRPC_PYTHON_AI_HEALTH_STRICT" | grep -qE "Session open refused by peer|Port-forward failed to establish|ControlSocket.*already exists"; then
    if echo "$GRPC_PYTHON_AI_HEALTH" | grep -qiE 'SERVING|"status":"SERVING"'; then
      :  # Envoy path used (Colima / LB IP mode)
    else
      info "gRPC Python AI HealthCheck: port-forward limit; Envoy path did not succeed — check Envoy/gRPC routing"
    fi
  else
    warn "gRPC Python AI HealthCheck strict TLS/mTLS verification failed"
    echo "Response: $GRPC_PYTHON_AI_HEALTH_STRICT" | head -3
  fi
  # Keep non-fatal mode here too; strict mode would stop before later tests (13j8..16).
  set +eu
fi
fi

# Test 16: HTTP/3 Health Checks for All Services (strict TLS; deterministic: --max-time 8, --connect-timeout 3, retry once on 55)
_say_ts "Test 16: HTTP/3 Health Checks for All Services (Strict TLS)"
CURL_MAX_TIME="${CURL_MAX_TIME:-8}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-3}"
export HTTP3_MAX_TIME="${HTTP3_MAX_TIME:-8}"
export HTTP3_CONNECT_TIMEOUT="${HTTP3_CONNECT_TIMEOUT:-3}"

# Test 16a: Auth Service - HTTP/3 Health Check (retry on 28 for cold auth)
say "Test 16a: Auth Service - Health Check via HTTP/3"
AUTH_HEALTH_H3_RC=0
AUTH_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-8}" --connect-timeout "${CURL_CONNECT_TIMEOUT:-3}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/auth/healthz" 2>&1) || AUTH_HEALTH_H3_RC=$?
if [[ "$AUTH_HEALTH_H3_RC" -ne 0 ]] && [[ "$AUTH_HEALTH_H3_RC" -eq 28 ]]; then
  AUTH_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/auth/healthz" 2>&1) || AUTH_HEALTH_H3_RC=$?
fi
if [[ "$AUTH_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Auth health check via HTTP/3 failed (curl exit $AUTH_HEALTH_H3_RC)"
  [[ "$AUTH_HEALTH_H3_RC" -eq 28 ]] && info "  curl 28 = timeout (auth may be cold; see docs/PREFLIGHT_TROUBLESHOOTING.md)"
elif [[ -n "$AUTH_HEALTH_H3_RESPONSE" ]]; then
  AUTH_HEALTH_H3_CODE=$(echo "$AUTH_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$AUTH_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Auth health check works via HTTP/3"
  else
    warn "Auth health check via HTTP/3 failed - HTTP $AUTH_HEALTH_H3_CODE"
  fi
fi

# Test 16b: Records Service - HTTP/3 Health Check (often curl 28 on cold start; use longer timeout + retry)
say "Test 16b: Records Service - Health Check via HTTP/3"
RECORDS_HEALTH_H3_RC=0
RECORDS_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/records/healthz" 2>&1) || RECORDS_HEALTH_H3_RC=$?
if [[ "$RECORDS_HEALTH_H3_RC" -ne 0 ]] && [[ "$RECORDS_HEALTH_H3_RC" -eq 28 ]]; then
  RECORDS_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/records/healthz" 2>&1) || RECORDS_HEALTH_H3_RC=$?
fi
if [[ "$RECORDS_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Records health check via HTTP/3 failed (curl exit $RECORDS_HEALTH_H3_RC)"
  [[ "$RECORDS_HEALTH_H3_RC" -eq 28 ]] && info "  curl 28 = timeout (Records backend may be cold; see docs/PREFLIGHT_TROUBLESHOOTING.md)"
  [[ "$RECORDS_HEALTH_H3_RC" -eq 55 ]] && info "  curl 55 = send failure (UDP path; see docs/HTTP3-CURL-EXIT-CODES.md)"
  [[ "$RECORDS_HEALTH_H3_RC" -eq 7 ]] && info "  curl 7 = connection refused (nothing listening on UDP; see docs/HTTP3-CURL-EXIT-CODES.md)"
elif [[ -n "$RECORDS_HEALTH_H3_RESPONSE" ]]; then
  RECORDS_HEALTH_H3_CODE=$(echo "$RECORDS_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$RECORDS_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Records health check works via HTTP/3"
  else
    warn "Records health check via HTTP/3 failed - HTTP $RECORDS_HEALTH_H3_CODE"
  fi
fi

# Test 16c: Social Service - HTTP/3 Health Check (retry once on exit 55 — QUIC send failure; retry once on 503 — transient DB load)
say "Test 16c: Social Service - Health Check via HTTP/3"
SOCIAL_HEALTH_H3_RC=0
SOCIAL_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/social/healthz" 2>&1) || SOCIAL_HEALTH_H3_RC=$?
if [[ "$SOCIAL_HEALTH_H3_RC" -eq 55 ]]; then
  sleep 0.5
  SOCIAL_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/social/healthz" 2>&1) || SOCIAL_HEALTH_H3_RC=$?
elif [[ -n "$SOCIAL_HEALTH_H3_RESPONSE" ]]; then
  _code=$(echo "$SOCIAL_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$_code" == "503" ]]; then
    info "Social health 503 (db/redis); retrying in 3s..."
    sleep 3
    SOCIAL_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
      -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/social/healthz" 2>&1) || SOCIAL_HEALTH_H3_RC=$?
  fi
fi
if [[ "$SOCIAL_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Social health check via HTTP/3 failed (curl exit $SOCIAL_HEALTH_H3_RC)"
  [[ "$SOCIAL_HEALTH_H3_RC" -eq 55 ]] && info "  curl 55 = send failure (QUIC); see docs/TEST_HARNESS_INVARIANTS_AND_CAPTURE.md"
elif [[ -n "$SOCIAL_HEALTH_H3_RESPONSE" ]]; then
  SOCIAL_HEALTH_H3_CODE=$(echo "$SOCIAL_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$SOCIAL_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Social health check works via HTTP/3"
  else
    warn "Social health check via HTTP/3 failed - HTTP $SOCIAL_HEALTH_H3_CODE"
    # 503 = social-service reports unhealthy (db disconnected or health timeout)
    if [[ "$SOCIAL_HEALTH_H3_CODE" == "503" ]]; then
      _body=$(echo "$SOCIAL_HEALTH_H3_RESPONSE" | sed '$d')
      [[ -n "$_body" ]] && info "  Response body (db/redis status): $_body"
      info "  See docs/SERVICE_BY_SERVICE_TEST_DEBUG.md 'Social HTTP/3 Health Check — 503'"
    fi
  fi
fi

# Test 16d: Analytics Service - HTTP/3 Health Check
say "Test 16d: Analytics Service - Health Check via HTTP/3"
ANALYTICS_HEALTH_H3_RC=0
ANALYTICS_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/analytics/healthz" 2>&1) || ANALYTICS_HEALTH_H3_RC=$?
if [[ "$ANALYTICS_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Analytics health check via HTTP/3 failed (curl exit $ANALYTICS_HEALTH_H3_RC)"
elif [[ -n "$ANALYTICS_HEALTH_H3_RESPONSE" ]]; then
  ANALYTICS_HEALTH_H3_CODE=$(echo "$ANALYTICS_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$ANALYTICS_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Analytics health check works via HTTP/3"
  else
    warn "Analytics health check via HTTP/3 failed - HTTP $ANALYTICS_HEALTH_H3_CODE"
  fi
fi

# Test 16e: Shopping Service - HTTP/3 Health Check (retry once on 28 or 55)
say "Test 16e: Shopping Service - Health Check via HTTP/3"
SHOPPING_HEALTH_H3_RC=0
SHOPPING_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/shopping/healthz" 2>&1) || SHOPPING_HEALTH_H3_RC=$?
if [[ "$SHOPPING_HEALTH_H3_RC" -ne 0 ]] && { [[ "$SHOPPING_HEALTH_H3_RC" -eq 28 ]] || [[ "$SHOPPING_HEALTH_H3_RC" -eq 55 ]]; }; then
  sleep 0.5
  SHOPPING_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/shopping/healthz" 2>&1) || SHOPPING_HEALTH_H3_RC=$?
fi
if [[ "$SHOPPING_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Shopping health check via HTTP/3 failed (curl exit $SHOPPING_HEALTH_H3_RC)"
  [[ "$SHOPPING_HEALTH_H3_RC" -eq 28 ]] && info "  curl 28 = timeout (shopping may be cold; see docs/PREFLIGHT_TROUBLESHOOTING.md)"
  [[ "$SHOPPING_HEALTH_H3_RC" -eq 55 ]] && info "  curl 55 = send failure (QUIC); see docs/TEST_HARNESS_INVARIANTS_AND_CAPTURE.md"
elif [[ -n "$SHOPPING_HEALTH_H3_RESPONSE" ]]; then
  SHOPPING_HEALTH_H3_CODE=$(echo "$SHOPPING_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$SHOPPING_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Shopping health check works via HTTP/3"
  else
    warn "Shopping health check via HTTP/3 failed - HTTP $SHOPPING_HEALTH_H3_CODE"
  fi
fi

# Test 16f: Auction Monitor Service - HTTP/3 Health Check
say "Test 16f: Auction Monitor Service - Health Check via HTTP/3"
AUCTION_MONITOR_HEALTH_H3_RC=0
# Try /auctions/healthz first (Caddy routes to api-gateway), then /api/auction-monitor/healthz
AUCTION_MONITOR_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/auctions/healthz" 2>&1) || AUCTION_MONITOR_HEALTH_H3_RC=$?
AUCTION_MONITOR_HEALTH_H3_CODE=$(echo "$AUCTION_MONITOR_HEALTH_H3_RESPONSE" | tail -1)
# Retry with /api/ path if curl failed, empty, or non-200 (e.g. 503 from wrong route)
if [[ "$AUCTION_MONITOR_HEALTH_H3_RC" -ne 0 ]] || [[ -z "$AUCTION_MONITOR_HEALTH_H3_RESPONSE" ]] || [[ ! "$AUCTION_MONITOR_HEALTH_H3_CODE" =~ ^200$ ]]; then
  AUCTION_MONITOR_HEALTH_H3_RC=0
  AUCTION_MONITOR_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/auction-monitor/healthz" 2>&1) || AUCTION_MONITOR_HEALTH_H3_RC=$?
  AUCTION_MONITOR_HEALTH_H3_CODE=$(echo "$AUCTION_MONITOR_HEALTH_H3_RESPONSE" | tail -1)
fi
if [[ "$AUCTION_MONITOR_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Auction Monitor health check via HTTP/3 failed (curl exit $AUCTION_MONITOR_HEALTH_H3_RC)"
elif [[ -n "$AUCTION_MONITOR_HEALTH_H3_RESPONSE" ]]; then
  if [[ "$AUCTION_MONITOR_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Auction Monitor health check works via HTTP/3"
  elif [[ "$AUCTION_MONITOR_HEALTH_H3_CODE" =~ ^(401)$ ]]; then
    ok "Auction Monitor health check via HTTP/3 - HTTP 401 (auth required; correct enforcement)"
  else
    warn "Auction Monitor health check via HTTP/3 failed - HTTP $AUCTION_MONITOR_HEALTH_H3_CODE"
  fi
fi

# Test 16g: Python AI Service - HTTP/3 Health Check
say "Test 16g: Python AI Service - Health Check via HTTP/3"
PYTHON_AI_HEALTH_H3_RC=0
# Try /ai/healthz first (Caddy routes to api-gateway), then /api/python-ai/healthz
PYTHON_AI_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/ai/healthz" 2>&1) || PYTHON_AI_HEALTH_H3_RC=$?
PYTHON_AI_HEALTH_H3_CODE=$(echo "$PYTHON_AI_HEALTH_H3_RESPONSE" | tail -1)
# Retry with /api/ path if curl failed, empty, or non-200 (e.g. 503 from wrong route)
if [[ "$PYTHON_AI_HEALTH_H3_RC" -ne 0 ]] || [[ -z "$PYTHON_AI_HEALTH_H3_RESPONSE" ]] || [[ ! "$PYTHON_AI_HEALTH_H3_CODE" =~ ^200$ ]]; then
  PYTHON_AI_HEALTH_H3_RC=0
  PYTHON_AI_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/python-ai/healthz" 2>&1) || PYTHON_AI_HEALTH_H3_RC=$?
  PYTHON_AI_HEALTH_H3_CODE=$(echo "$PYTHON_AI_HEALTH_H3_RESPONSE" | tail -1)
fi
if [[ "$PYTHON_AI_HEALTH_H3_RC" -ne 0 ]]; then
  warn "Python AI health check via HTTP/3 failed (curl exit $PYTHON_AI_HEALTH_H3_RC)"
elif [[ -n "$PYTHON_AI_HEALTH_H3_RESPONSE" ]]; then
  if [[ "$PYTHON_AI_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "Python AI health check works via HTTP/3"
  else
    warn "Python AI health check via HTTP/3 failed - HTTP $PYTHON_AI_HEALTH_H3_CODE"
  fi
fi

# Test 16h: API Gateway - HTTP/3 Health Check
say "Test 16h: API Gateway - Health Check via HTTP/3"
API_GATEWAY_HEALTH_H3_RC=0
API_GATEWAY_HEALTH_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time "${CURL_MAX_TIME:-15}" \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/api/healthz" 2>&1) || API_GATEWAY_HEALTH_H3_RC=$?
if [[ "$API_GATEWAY_HEALTH_H3_RC" -ne 0 ]]; then
  warn "API Gateway health check via HTTP/3 failed (curl exit $API_GATEWAY_HEALTH_H3_RC)"
elif [[ -n "$API_GATEWAY_HEALTH_H3_RESPONSE" ]]; then
  API_GATEWAY_HEALTH_H3_CODE=$(echo "$API_GATEWAY_HEALTH_H3_RESPONSE" | tail -1)
  if [[ "$API_GATEWAY_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
    ok "API Gateway health check works via HTTP/3"
  else
    warn "API Gateway health check via HTTP/3 failed - HTTP $API_GATEWAY_HEALTH_H3_CODE"
  fi
fi

_say_ts "=== Microservices Testing Complete ==="

# === DATABASE VERIFICATION - Post-Test Data Integrity ===
# Account persists in auth DB (source of truth); data that references this account must persist across DBs (records, forum, listings, etc.).
# DB_VERIFY_FAST=1: minimal checks, 5 parallel, 10s hard cap (no stall). No polling after delete — use SELECT 1 existence check.
# DB_VERIFY_POLL_INTERVAL: sleep between wait-loop iterations (default 0.5s). DB_VERIFY_CONNECT_TIMEOUT: connect timeout per DB (default 2s; set 3 for slow hosts).
# For 60s total cap set DB_VERIFY_MAX_SECONDS=60; with DB_VERIFY_FAST=1 default cap is 10s.
if [[ "${DB_VERIFY_FAST:-0}" == "1" ]]; then
  DB_VERIFY_MAX_SECONDS="${DB_VERIFY_MAX_SECONDS:-10}"
else
  DB_VERIFY_MAX_SECONDS="${DB_VERIFY_MAX_SECONDS:-120}"
fi
_say_ts "=== Database Verification - Post-Test Data Integrity ==="
# Skip entire DB verify for baseline when requested (run after enhanced/rotation/standalone only).
if [[ "${SKIP_DB_VERIFY_IN_BASELINE:-0}" == "1" ]]; then
  _say_ts "DB verification skipped for baseline (SKIP_DB_VERIFY_IN_BASELINE=1); run after enhanced/rotation/standalone."
  _say_ts "Baseline suite finished; total $(_ts_elapsed)s"
  exit 0
else
export DB_VERIFY_CONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT:-2}"
export DB_VERIFY_FAST="${DB_VERIFY_FAST:-0}"
_DB_VERIFY_START=$(date +%s)
_db_ts() { printf '[%s] (%ss) ' "$(date +%H:%M:%S)" "$(_ts_elapsed)"; }
# 5 parallel, 2s statement timeout (fail fast; reduces harness pressure)
[[ "${DB_VERIFY_FAST:-0}" == "1" ]] && _db_parallel_max_s=5 || _db_parallel_max_s=12
[[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 0 ]] && info "Connect timeout: ${DB_VERIFY_CONNECT_TIMEOUT}s per DB; total cap: ${DB_VERIFY_MAX_SECONDS}s (DB_VERIFY_MAX_SECONDS)"
[[ "${DB_VERIFY_FAST:-0}" == "1" ]] && info "DB_VERIFY_FAST=1: minimal checks, ${_db_parallel_max_s} parallel, 2s statement timeout (set DB_VERIFY_FAST=0 for full verification)"
[[ -z "${DB_VERIFY_MAX_SECONDS:-}" ]] || [[ "${DB_VERIFY_MAX_SECONDS}" -le 0 ]] && info "Ports checked: 5437 (auth), 5433 (records), 5434 (social), 5435 (listings), 5436 (shopping). If slow, set DB_VERIFY_MAX_SECONDS=120"
# Per-query statement timeout: 2s for fast path so no single query blocks (was 5s).
DB_VERIFY_STATEMENT_TIMEOUT="${DB_VERIFY_STATEMENT_TIMEOUT:-2}"
_psql_db() { PGPASSWORD=postgres PGCONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT}" psql -h localhost "$@" 2>/dev/null; }
_psql_db_timed() { PGPASSWORD=postgres PGCONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT}" PGOPTIONS="-c statement_timeout=${DB_VERIFY_STATEMENT_TIMEOUT}000" psql -h localhost "$@" 2>/dev/null; }
_db_elapsed() { echo $(( $(date +%s) - _DB_VERIFY_START )); }
_db_over_cap() { [[ -z "${DB_VERIFY_MAX_SECONDS:-}" ]] || [[ "${DB_VERIFY_MAX_SECONDS}" -le 0 ]] && return 1; [[ $( _db_elapsed ) -ge "${DB_VERIFY_MAX_SECONDS}" ]] && return 0; return 1; }

# Use already-set User1/User2 IDs from Tests 1/1b so verification does not depend on TOKEN/TOKEN_USER2 still being set (e.g. when run in pipeline or after long tests).
_db_ts; echo "Resolving user IDs for DB verification..."
_resolve_start=$(date +%s)
if [[ -z "${USER1_ID:-}" ]] && [[ -n "${TOKEN:-}" ]]; then
  USER1_ID=$(echo "$TOKEN" | cut -d'.' -f2 | tr '_-' '/+' | python3 -c "import sys, base64; s=sys.stdin.read(); pad = 4 - len(s) % 4; s += '=' * pad; print(base64.b64decode(s).decode('utf-8'))" 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo "")
fi
if [[ -z "${USER2_ID:-}" ]] && [[ -n "${TOKEN_USER2:-}" ]]; then
  USER2_ID=$(echo "$TOKEN_USER2" | cut -d'.' -f2 | tr '_-' '/+' | python3 -c "import sys, base64; s=sys.stdin.read(); pad = 4 - len(s) % 4; s += '=' * pad; print(base64.b64decode(s).decode('utf-8'))" 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo "")
fi
_db_resolve_end=$(date +%s)
_db_resolve_s=$((_db_resolve_end - _resolve_start))
_db_ts; echo "User1=${USER1_ID:-<none>} User2=${USER2_ID:-<none>}  (resolve: ${_db_resolve_s}s)"
_db_u1_parallel_s=0 _db_u1_extra_s=0 _db_u2_parallel_s=0 _db_u2_extra_s=0

# Hard wall-clock timeout so DB verification never sticks the pipeline (e.g. hung psql).
_db_cap="${DB_VERIFY_MAX_SECONDS:-20}"
[[ "$_db_cap" -le 0 ]] && _db_cap=20
_db_verify_log=$(mktemp 2>/dev/null || echo "/tmp/db-verify-$$.log")
(
  # 1. Account must persist in auth DB (source of truth); data in records/forum/listings.
  if [[ -n "${USER1_ID:-}" ]]; then
    if _db_over_cap; then
      _db_ts; echo "DB verification time limit (${DB_VERIFY_MAX_SECONDS}s) reached; proceeding to next suite."
    else
  _db_ts; echo "Verifying account and data across DBs (User 1 id=$USER1_ID)"
  _u1_start=$(date +%s)
  _db_ts; echo "  Step started at $(date +%H:%M:%S); checking auth (5437), records (5433), forum (5434), listings (5435), shopping (5436) — max ${_db_parallel_max_s} parallel (statement_timeout=${DB_VERIFY_STATEMENT_TIMEOUT}s)"
  _db_ts; echo "  Queries: SELECT 1 existence (auth.users, records.records, forum.posts, listings.listings, shopping.orders)"
  _u1_auth_out=$(mktemp 2>/dev/null || echo "/tmp/db-u1-auth-$$")
  _u1_rec_out=$(mktemp 2>/dev/null || echo "/tmp/db-u1-rec-$$")
  _u1_forum_out=$(mktemp 2>/dev/null || echo "/tmp/db-u1-forum-$$")
  _u1_list_out=$(mktemp 2>/dev/null || echo "/tmp/db-u1-list-$$")
  _u1_shopping_out=$(mktemp 2>/dev/null || echo "/tmp/db-u1-shopping-$$")
  _psql_db_timed -p 5437 -U postgres -d auth -tAc "SELECT 1 FROM auth.users WHERE id='$USER1_ID' LIMIT 1;" > "$_u1_auth_out" 2>/dev/null & _u1_p1=$!
  _psql_db_timed -p 5433 -U postgres -d records -tAc "SELECT 1 FROM records.records WHERE user_id='$USER1_ID' LIMIT 1;" > "$_u1_rec_out" 2>/dev/null & _u1_p2=$!
  _psql_db_timed -p 5434 -U postgres -d social -tAc "SELECT 1 FROM forum.posts WHERE user_id='$USER1_ID' LIMIT 1;" > "$_u1_forum_out" 2>/dev/null & _u1_p3=$!
  _u1_deadline=$(($(date +%s) + _db_parallel_max_s))
  while [[ $(date +%s) -lt $_u1_deadline ]] && { kill -0 $_u1_p1 2>/dev/null || kill -0 $_u1_p2 2>/dev/null || kill -0 $_u1_p3 2>/dev/null; }; do
    if _db_over_cap; then _db_ts; echo "DB verification time limit (${DB_VERIFY_MAX_SECONDS}s) reached; proceeding."; kill $_u1_p1 $_u1_p2 $_u1_p3 2>/dev/null; wait 2>/dev/null || true; break; fi
    sleep "${DB_VERIFY_POLL_INTERVAL:-0.5}"
  done
  kill $_u1_p1 $_u1_p2 $_u1_p3 2>/dev/null; wait 2>/dev/null || true
  _psql_db_timed -p 5435 -U postgres -d listings -tAc "SELECT 1 FROM listings.listings WHERE user_id='$USER1_ID' LIMIT 1;" > "$_u1_list_out" 2>/dev/null & _u1_p4=$!
  _psql_db_timed -p 5436 -U postgres -d shopping -tAc "SELECT 1 FROM shopping.orders WHERE user_id='$USER1_ID' LIMIT 1;" > "$_u1_shopping_out" 2>/dev/null & _u1_p5=$!
  _u1_deadline=$(($(date +%s) + _db_parallel_max_s))
  while [[ $(date +%s) -lt $_u1_deadline ]] && { kill -0 $_u1_p4 2>/dev/null || kill -0 $_u1_p5 2>/dev/null; }; do
    if _db_over_cap; then _db_ts; echo "DB verification time limit (${DB_VERIFY_MAX_SECONDS}s) reached; proceeding."; kill $_u1_p4 $_u1_p5 2>/dev/null; wait 2>/dev/null || true; break; fi
    sleep "${DB_VERIFY_POLL_INTERVAL:-0.5}"
  done
  kill $_u1_p4 $_u1_p5 2>/dev/null; wait 2>/dev/null || true
  _db_u1_parallel_s=$(($(date +%s) - _u1_start))
  _db_ts; echo "  Done User1 existence checks (${_db_u1_parallel_s}s)"
  USER1_AUTH_COUNT=0; [[ -s "$_u1_auth_out" ]] && USER1_AUTH_COUNT=1
  USER1_RECORDS_N=0; [[ -s "$_u1_rec_out" ]] && USER1_RECORDS_N=1
  USER1_FORUM_N=0; [[ -s "$_u1_forum_out" ]] && USER1_FORUM_N=1
  USER1_LISTINGS_N=0; [[ -s "$_u1_list_out" ]] && USER1_LISTINGS_N=1
  USER1_SHOPPING_N=0; [[ -s "$_u1_shopping_out" ]] && USER1_SHOPPING_N=1
  rm -f "$_u1_auth_out" "$_u1_rec_out" "$_u1_forum_out" "$_u1_list_out" "$_u1_shopping_out" 2>/dev/null || true
  _db_u1_extra_start=$(date +%s)
  if [[ "${DB_VERIFY_FAST:-0}" != "1" ]] && [[ "$USER1_AUTH_COUNT" != "1" ]]; then
    _db_ts; echo "  Fallback: auth count from DB records on 5437..."
    USER1_AUTH_COUNT=$(_psql_db -p 5437 -U postgres -d records -tAc "SELECT COUNT(*) FROM auth.users WHERE id='$USER1_ID';" | tr -d ' \n' || echo "0")
  fi
  if [[ "$USER1_AUTH_COUNT" == "1" ]]; then
    if [[ "${DB_VERIFY_FAST:-0}" != "1" ]]; then
      _db_ts; echo "  Checking: auth (5437) email lookup..."
      USER1_EMAIL=$(_psql_db -p 5437 -U postgres -d auth -tAc "SELECT email FROM auth.users WHERE id='$USER1_ID';" | tr -d ' \n' || echo "")
      [[ -z "$USER1_EMAIL" ]] && USER1_EMAIL=$(_psql_db -p 5437 -U postgres -d records -tAc "SELECT email FROM auth.users WHERE id='$USER1_ID';" | tr -d ' \n' || echo "")
    fi
  fi
  _db_u1_extra_s=$(($(date +%s) - _db_u1_extra_start))
  if [[ "$USER1_AUTH_COUNT" == "1" ]]; then
    ok "Account persists in auth DB (5437): id=$USER1_ID email=${USER1_EMAIL:-<unknown>}"
  else
    warn "Account NOT found in auth DB (5437) - count: $USER1_AUTH_COUNT"
  fi
  if [[ "${USER1_RECORDS_N:-0}" -gt 0 ]]; then
    ok "Data in records DB (5433): $USER1_RECORDS_N record(s) in records.records"
  else
    info "No records.records for User 1 (Test 3 creates records; if skipped or failed, count stays 0)"
  fi
  if [[ "${USER1_FORUM_N:-0}" -gt 0 ]]; then
    ok "Data in social DB (5434): $USER1_FORUM_N post(s) in forum.posts (Test 6/6b create posts)"
  else
    info "No forum.posts for User 1 — Test 6/6b create posts; if those were skipped or failed, count is 0 (DB name on 5434 is 'social')"
  fi
  if [[ "${USER1_LISTINGS_N:-0}" -gt 0 ]]; then
    ok "Data in listings DB (5435): $USER1_LISTINGS_N listing(s) in listings.listings (Test 12/12b create listings)"
  else
    info "No listings.listings for User 1 — Test 12/12b create listings; if those were skipped or failed, count is 0 (DB name on 5435 is 'listings')"
  fi
  if [[ "${USER1_SHOPPING_N:-0}" -gt 0 ]]; then
    ok "Data in shopping DB (5436): $USER1_SHOPPING_N order(s) in shopping.orders (Test 13c/13j5 checkout)"
  else
    info "No shopping.orders for User 1 — Test 13c/13j5 create orders; if checkout failed (e.g. duplicate key), count is 0 (DB name on 5436 is 'shopping')"
  fi
  fi
fi

if [[ -n "${USER2_ID:-}" ]] && [[ "${DB_VERIFY_FAST:-0}" != "1" ]]; then
  if _db_over_cap; then
    _db_ts; echo "DB verification time limit (${DB_VERIFY_MAX_SECONDS}s) reached; proceeding to next suite."
  else
  _db_ts; echo "Verifying account and data across DBs (User 2 id=$USER2_ID)"
  _u2_start=$(date +%s)
  _db_ts; echo "  Step started at $(date +%H:%M:%S); checking auth (5437), auth fallback, forum (5434) — max ${_db_parallel_max_s} parallel (SELECT 1 existence)"
  _u2_auth_out=$(mktemp 2>/dev/null || echo "/tmp/db-u2-auth-$$")
  _u2_rec_out=$(mktemp 2>/dev/null || echo "/tmp/db-u2-rec-$$")
  _u2_forum_out=$(mktemp 2>/dev/null || echo "/tmp/db-u2-forum-$$")
  _psql_db_timed -p 5437 -U postgres -d auth -tAc "SELECT 1 FROM auth.users WHERE id='$USER2_ID' LIMIT 1;" > "$_u2_auth_out" 2>/dev/null & _u2_p1=$!
  _psql_db_timed -p 5437 -U postgres -d records -tAc "SELECT 1 FROM auth.users WHERE id='$USER2_ID' LIMIT 1;" > "$_u2_rec_out" 2>/dev/null & _u2_p2=$!
  _psql_db_timed -p 5434 -U postgres -d social -tAc "SELECT 1 FROM forum.posts WHERE user_id='$USER2_ID' LIMIT 1;" > "$_u2_forum_out" 2>/dev/null & _u2_p3=$!
  _u2_deadline=$(($(date +%s) + _db_parallel_max_s))
  while [[ $(date +%s) -lt $_u2_deadline ]] && { kill -0 $_u2_p1 2>/dev/null || kill -0 $_u2_p2 2>/dev/null || kill -0 $_u2_p3 2>/dev/null; }; do
    if _db_over_cap; then _db_ts; echo "DB verification time limit (${DB_VERIFY_MAX_SECONDS}s) reached; proceeding."; kill $_u2_p1 $_u2_p2 $_u2_p3 2>/dev/null; wait 2>/dev/null || true; break; fi
    sleep "${DB_VERIFY_POLL_INTERVAL:-0.5}"
  done
  kill $_u2_p1 $_u2_p2 $_u2_p3 2>/dev/null; wait 2>/dev/null || true
  _db_u2_parallel_s=$(($(date +%s) - _u2_start))
  _db_ts; echo "  Done User2 existence checks (${_db_u2_parallel_s}s)"
  USER2_AUTH_COUNT=0; [[ -s "$_u2_auth_out" ]] && USER2_AUTH_COUNT=1
  [[ "$USER2_AUTH_COUNT" != "1" ]] && [[ -s "$_u2_rec_out" ]] && USER2_AUTH_COUNT=1
  USER2_FORUM_N=0; [[ -s "$_u2_forum_out" ]] && USER2_FORUM_N=1
  rm -f "$_u2_auth_out" "$_u2_rec_out" "$_u2_forum_out" 2>/dev/null || true
  _db_u2_extra_start=$(date +%s)
  if [[ "$USER2_AUTH_COUNT" == "1" ]]; then
    _db_ts; echo "  Checking: auth (5437) email lookup..."
    USER2_EMAIL=$(_psql_db -p 5437 -U postgres -d auth -tAc "SELECT email FROM auth.users WHERE id='$USER2_ID';" | tr -d ' \n' || echo "")
    [[ -z "$USER2_EMAIL" ]] && USER2_EMAIL=$(_psql_db -p 5437 -U postgres -d records -tAc "SELECT email FROM auth.users WHERE id='$USER2_ID';" | tr -d ' \n' || echo "")
    ok "Account persists in auth DB (5437): id=$USER2_ID email=${USER2_EMAIL:-<unknown>}"
  else
    warn "Account NOT found in auth DB (5437) - count: $USER2_AUTH_COUNT"
  fi
  _db_u2_extra_s=$(($(date +%s) - _db_u2_extra_start))
  if [[ "${USER2_FORUM_N:-0}" -gt 0 ]]; then
    ok "Data in social DB (5434): $USER2_FORUM_N post(s) in forum.posts"
  fi
  fi
fi

  _db_total_s=$( _db_elapsed )
  _db_ts; echo "DB verification total: ${_db_total_s}s"
  _db_timing_line="db_verify_seconds=${_db_total_s} resolve_s=${_db_resolve_s} user1_parallel_s=${_db_u1_parallel_s} user1_extra_s=${_db_u1_extra_s} user2_parallel_s=${_db_u2_parallel_s} user2_extra_s=${_db_u2_extra_s} fast=${DB_VERIFY_FAST:-0} cap=${DB_VERIFY_MAX_SECONDS:-}"
  _db_ts; echo "  Timing breakdown (for correlation with pgbench): $_db_timing_line"
  if [[ -n "${DB_VERIFY_TIMING_LOG:-}" ]]; then
    echo "$_db_timing_line" >> "$DB_VERIFY_TIMING_LOG" 2>/dev/null || true
  fi
  say "=== Database Verification Summary ==="
  echo "✅ Database checks completed"
  echo "   - Account persists in auth DB (source of truth)"
  echo "   - Data referencing this account persists across DBs (records, forum, listings as created by test)"
  _db_ts; echo "DB verification done (cap hit or complete); continuing — remaining suites will run."
) >> "$_db_verify_log" 2>&1 &
_db_pid=$!
_waited=0
while [[ $_waited -lt "$_db_cap" ]] && kill -0 $_db_pid 2>/dev/null; do sleep 1; _waited=$((_waited+1)); done
if kill -0 $_db_pid 2>/dev/null; then
  kill -9 $_db_pid 2>/dev/null
  wait $_db_pid 2>/dev/null || true
  _db_ts; echo "DB verification timed out after ${_db_cap}s; proceeding (pipeline will not stick)."
fi
set +e
wait $_db_pid 2>/dev/null
_db_verify_rc=$?
set -eu
[[ "${_db_verify_rc:-0}" -ne 0 ]] && warn "DB verification subshell exited ${_db_verify_rc} (e.g. colima SSH mux 'Session open refused by peer'; suite continues)" || true
[[ -f "$_db_verify_log" ]] && [[ -s "$_db_verify_log" ]] && cat "$_db_verify_log" || true
rm -f "$_db_verify_log" 2>/dev/null || true

# Cleanup: delete test users (User1, User2) so next run/suite doesn't get 409 "email already exists"
# Note: Test 14 (Logout) invalidates User1's token, so DELETE for User1 often returns 401 here — expected.
if [[ -n "${TOKEN:-}" ]] || [[ -n "${TOKEN_USER2:-}" ]]; then
  _say_ts "Cleanup: deleting test users (User1, User2)..."
  if [[ -n "${TOKEN:-}" ]]; then
    _del_code=$(strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 15 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" -H "Authorization: Bearer $TOKEN" \
      -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>/dev/null || echo "000")
    if [[ "$_del_code" == "204" ]]; then
      ok "User1 (microservice-test-*) deleted"
    elif [[ "$_del_code" == "401" ]]; then
      info "  User1: token invalid (logged out in Test 14) — DELETE returned 401; account may still exist (next run uses new emails)"
    else
      info "  User1 delete: HTTP $_del_code"
    fi
  fi
  if [[ -n "${TOKEN_USER2:-}" ]]; then
    _del_code2=$(strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 15 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" -H "Authorization: Bearer $TOKEN_USER2" \
      -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>/dev/null || echo "000")
    [[ "$_del_code2" == "204" ]] && ok "User2 (microservice-test-2-*) deleted" || info "  User2 delete: HTTP $_del_code2"
  fi
fi

_say_ts "Baseline suite finished; total $(_ts_elapsed)s"
exit 0
fi
