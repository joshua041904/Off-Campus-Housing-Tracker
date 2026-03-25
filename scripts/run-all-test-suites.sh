#!/usr/bin/env bash
# Run housing + protocol test suites only: auth, rotation, standalone-capture, tls-mtls.
# Legacy suites (baseline, enhanced, adversarial, social, lb-coordinated) are removed; only protocol checks and housing-relevant auth remain.
# CA and leaf are both rotated in rotation suite; certs/dev-root.pem is the single source of truth. k6 runs after rotation when RUN_K6=1 (strict TLS only).
#
# Breakdown: (1) Guardrail: no Kind/h3; when REQUIRE_COLIMA=0 (k3d), any context allowed; when REQUIRE_COLIMA=1, Colima required. (2) If SKIP_FULL_PREFLIGHT!=1, runs full preflight first. (3) Kill stale pipeline/suite/capture processes, then cleanup port-forwards. (4) Kubeconfig/preflight fix and ensure-api-server-ready. (5) Strict TLS/mTLS preflight. (6) Runs 4 suites in order; k6 after rotation when RUN_K6=1; DB & Cache verification after each suite.
# Pipe: ./run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }
info() { echo "ℹ️  $*"; }

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
cd "$REPO_ROOT"

if [[ -f "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh" ]]; then
  # shellcheck source=lib/k6-suite-resource-hooks.sh
  source "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh"
else
  k6_suite_after_k6_block() { return 0; }
fi

ctx=$(kubectl config current-context 2>/dev/null || true)
REQUIRE_COLIMA="${REQUIRE_COLIMA:-1}"

# Colima routing invariant: MetalLB only. NodePort and port-forward are NOT reachable from host on Colima.
# Colima orchestration: longer settle times, suite-level capture (no per-test kubectl exec churn), skip strict TLS port-forward.
if [[ "$ctx" == *"colima"* ]]; then
  export FORCE_METALLB_ONLY=1
  export DISABLE_NODEPORT=1
  export DISABLE_PORT_FORWARD=1
  export POST_ROLLOUT_SETTLE="${POST_ROLLOUT_SETTLE:-8}"
  export CAPTURE_SKIP_PER_TEST="${CAPTURE_SKIP_PER_TEST:-1}"
  export CAPTURE_WARMUP_SECONDS="${CAPTURE_WARMUP_SECONDS:-4}"
  export SKIP_GRPC_STRICT_PORT_FORWARD="${SKIP_GRPC_STRICT_PORT_FORWARD:-1}"
  export SKIP_REDIS_HOST_CHECK="${SKIP_REDIS_HOST_CHECK:-1}"
  info "Colima: FORCE_METALLB_ONLY=1, POST_ROLLOUT_SETTLE=8, CAPTURE_SKIP_PER_TEST=1, CAPTURE_WARMUP_SECONDS=4, SKIP_GRPC_STRICT_PORT_FORWARD=1 (orchestration-stable)"
fi

# Guardrail: no Kind/h3. When REQUIRE_COLIMA=0 (e.g. k3d), any context is allowed except kind/h3.
if [[ "$ctx" == *"kind"* ]] || [[ "$ctx" == "h3" ]]; then
  echo "❌ Kind/h3 clusters are not supported. Current context: $ctx"
  echo "   Use k3d (REQUIRE_COLIMA=0) or Colima + k3s (REQUIRE_COLIMA=1)."
  exit 1
fi
if [[ "$REQUIRE_COLIMA" == "1" ]] && [[ "$ctx" != *"colima"* ]]; then
  echo "❌ Colima + k3s required (REQUIRE_COLIMA=1). Current context: $ctx"
  echo "   Run: colima start --with-kubernetes && kubectl config use-context colima"
  echo "   Or run with REQUIRE_COLIMA=0 for k3d."
  exit 1
fi

# --- Full preflight first (so cluster is not corrupted) ---
if [[ "${SKIP_FULL_PREFLIGHT:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" ]]; then
  say "Full preflight first (run-preflight-scale-and-all-suites.sh with RUN_SUITES=0) so cluster is in a known good state…"
  if ! RUN_SUITES=0 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"; then
    fail "Full preflight failed. Fix issues above and re-run."
  fi
  ok "Full preflight complete; running test suites (SKIP_TLS_PREFLIGHT=1)."
  export SKIP_TLS_PREFLIGHT=1
fi

# Bound packet capture stop phase so it never blocks (baseline/enhanced use packet-capture.sh). Preflight sets these; when run standalone defaults apply.
export CAPTURE_STOP_TIMEOUT="${CAPTURE_STOP_TIMEOUT:-30}"
export CAPTURE_MAX_STOP_SECONDS="${CAPTURE_MAX_STOP_SECONDS:-75}"
# Cap DB/cache verification after each suite so it never blocks (see docs/PREFLIGHT_ISSUES_AND_FIXES_20260216.md)
export DB_VERIFY_MAX_SECONDS="${DB_VERIFY_MAX_SECONDS:-60}"

# Kill stale pipeline/suite/capture processes first so this run is not slowed or confused by previous runs.
# On k3d especially important: no Colima serialization; old run-all, rotation, k6, kubectl exec tcpdump can linger.
if [[ -f "$SCRIPT_DIR/find-and-kill-idle-then-run-pipeline.sh" ]]; then
  say "Pre-flight: killing stale pipeline/suite/capture processes (run-all, rotation, k6, kubectl wait, kubectl exec tcpdump)..."
  KILL=1 KILL_ONLY=1 CALLER_PID=$$ "$SCRIPT_DIR/find-and-kill-idle-then-run-pipeline.sh" 2>/dev/null || true
  sleep 1
fi

# Cleanup: kill leftover port-forwards; prune dangling Docker images by default (hygiene so builds/k3d don't see stale layers). Set DOCKER_PRUNE_STALE=0 to skip.
say "Pre-flight: cleanup (port-forwards + Kind clusters when Colima context)"
if [[ "${DOCKER_PRUNE_STALE:-1}" != "0" ]]; then
  docker image prune -f 2>/dev/null && info "Pruned dangling Docker images" || true
  # Remove old :dev images so k3d/build uses fresh ones (optional; set DOCKER_PRUNE_DEV=1 to also remove :dev)
  if [[ "${DOCKER_PRUNE_DEV:-0}" == "1" ]]; then
    _dev_images=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep ":dev$" || true)
    [[ -n "$_dev_images" ]] && echo "$_dev_images" | xargs docker rmi 2>/dev/null && info "Removed stale :dev images" || true
  fi
fi
PF_COUNT=$(pgrep -f "port-forward" 2>/dev/null | wc -l | tr -d ' \n' || echo "0")
if [[ "${PF_COUNT:-0}" -gt 0 ]]; then
  pkill -f "port-forward" 2>/dev/null || true
  pkill -f "colima ssh -- kubectl" 2>/dev/null || true
  sleep 1
  ok "Killed $PF_COUNT leftover port-forward process(es)"
else
  info "No leftover port-forwards found"
fi
if [[ "$ctx" == *"colima"* ]] && command -v kind >/dev/null 2>&1; then
  for name in kind-h3 kind-h3-multi h3; do
    if kind get clusters 2>/dev/null | grep -qx "$name"; then
      kind delete cluster --name "$name" 2>/dev/null && ok "Deleted Kind cluster: $name (Colima-only)" || warn "Could not delete Kind cluster: $name"
    fi
  done
fi

# Colima: if current kubeconfig has multiple clusters (e.g. KUBECONFIG=kind-h3.yaml with kind + colima), force single-cluster
# so "kubeadm KUBECONFIG should have one cluster" and API checks use only colima. Do this before any preflight/ensure.
if [[ "$ctx" == *"colima"* ]]; then
  cluster_count=$(kubectl config get-clusters 2>/dev/null | grep -c . 2>/dev/null || echo "0")
  if [[ "$cluster_count" -gt 1 ]]; then
    SINGLE_KUBE=$(mktemp 2>/dev/null || echo "/tmp/colima-single-kube-$$.yaml")
    if kubectl config view --minify --raw >"$SINGLE_KUBE" 2>/dev/null; then
      export KUBECONFIG="$SINGLE_KUBE"
      ok "Colima: using single-cluster kubeconfig (had $cluster_count clusters)"
    fi
  fi
fi

# Pre-flight: optimize kine if requested (fixes root cause of API server timeouts)
if [[ "${OPTIMIZE_KINE:-0}" == "1" ]] && command -v colima >/dev/null 2>&1; then
  say "Pre-flight: optimizing kine database (fixes API server timeout root cause)"
  if [[ -f "$SCRIPT_DIR/optimize-k3s-kine-database.sh" ]]; then
    colima kubernetes stop 2>/dev/null || true
    sleep 2
    "$SCRIPT_DIR/optimize-k3s-kine-database.sh" 2>/dev/null || warn "kine optimization had issues; continuing."
    colima kubernetes start 2>/dev/null || true
    sleep 15  # Wait for API server to be ready after restart
  else
    warn "kine optimization script not found; skipping"
  fi
fi

# Pre-flight: fix kubeconfig once (skip if SKIP_PREFLIGHT=1, e.g. from run-preflight-scale-and-all-suites)
if [[ "${SKIP_PREFLIGHT:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
  say "Pre-flight: kubeconfig (Colima 127.0.0.1:6443, Kind port)"
  PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || warn "Preflight had issues; continuing."
else
  say "Pre-flight: skipped (SKIP_PREFLIGHT=1)"
fi

if [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  say "Ensure API server ready before suites..."
  # k3d is faster: shorter cap and less sleep. Colima/k3s use longer cap and more attempts.
  ENSURE_CAP="${ENSURE_CAP:-120}"
  API_SERVER_SLEEP="${API_SERVER_SLEEP:-3}"
  API_SERVER_MAX_ATTEMPTS="${API_SERVER_MAX_ATTEMPTS:-12}"
  [[ "$ctx" == *"colima"* ]] && ENSURE_CAP="${ENSURE_CAP:-180}"
  [[ "$ctx" == *"k3d"* ]] && ENSURE_CAP="${ENSURE_CAP:-90}" && API_SERVER_SLEEP="${API_SERVER_SLEEP:-2}" && API_SERVER_MAX_ATTEMPTS="${API_SERVER_MAX_ATTEMPTS:-10}"
  if ! KUBECTL_REQUEST_TIMEOUT=15s API_SERVER_MAX_ATTEMPTS="$API_SERVER_MAX_ATTEMPTS" API_SERVER_SLEEP="$API_SERVER_SLEEP" \
    ENSURE_CAP="$ENSURE_CAP" PREFLIGHT_CAP=45 "$SCRIPT_DIR/ensure-api-server-ready.sh" 2>/dev/null; then
    warn "API server not ready. Aborting suites."
    exit 1
  fi
  ok "API server ready"
fi

# Pre-flight: STRICT TLS/mTLS — always run unless caller explicitly sets SKIP_TLS_PREFLIGHT=1.
# Ensures service-tls + dev-root-ca are valid and pods use them; all tests use strict TLS/mTLS (no skip).
say "Pre-flight: gRPC certs for strict TLS + mTLS (service-tls + dev-root-ca required)"
if [[ "${SKIP_TLS_PREFLIGHT:-0}" == "1" ]]; then
  # Caller explicitly skipped; still require certs to exist
  if [[ -s /tmp/grpc-certs/ca.crt ]]; then
    ok "Strict TLS/mTLS preflight skipped (SKIP_TLS_PREFLIGHT=1); using existing certs in /tmp/grpc-certs"
  else
    fail "SKIP_TLS_PREFLIGHT=1 but /tmp/grpc-certs/ca.crt missing. Run ensure-strict-tls-mtls-preflight.sh or full preflight first."
  fi
  export GRPC_CERTS_DIR="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
  export CA_CERT="$GRPC_CERTS_DIR/ca.crt"
else
  # Always run when not skipped — strict TLS/mTLS required for all tests (no -k / no skip).
  say "Running strict TLS/mTLS preflight (required for all tests; not skipped)"
  chmod +x "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" 2>/dev/null || true
  # FORCE_TLS_RESTART=1 so pods always pick up current service-tls (prevents 503 / "self-signed certificate in certificate chain" when running standalone).
  if ! FORCE_TLS_RESTART=1 "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"; then
    fail "Strict TLS/mTLS preflight failed. Suites require valid service-tls and dev-root-ca."
  fi
  export GRPC_CERTS_DIR="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
  export CA_CERT="$GRPC_CERTS_DIR/ca.crt"
fi
# Ensure tls.crt/tls.key exist for grpcurl mTLS (cluster secret or repo leaf); avoids "failed to find any PEM data".
if [[ -f "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh" ]]; then
  # shellcheck source=scripts/lib/ensure-och-grpc-certs.sh
  source "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh"
  och_sync_grpc_certs_to_dir "${GRPC_CERTS_DIR:-/tmp/grpc-certs}" "${HOUSING_NS:-off-campus-housing-tracker}" || true
  if [[ -s "${GRPC_CERTS_DIR:-/tmp/grpc-certs}/ca.crt" ]]; then
    export CA_CERT="${GRPC_CERTS_DIR:-/tmp/grpc-certs}/ca.crt"
  elif [[ -s "$REPO_ROOT/certs/dev-root.pem" ]]; then
    export CA_CERT="$REPO_ROOT/certs/dev-root.pem"
  fi
fi
if [[ -z "${KUBECTL_PORT_FORWARD:-}" ]]; then
  [[ -x /opt/homebrew/bin/kubectl ]] && export KUBECTL_PORT_FORWARD="/opt/homebrew/bin/kubectl --request-timeout=15s"
  [[ -z "${KUBECTL_PORT_FORWARD:-}" ]] && [[ -x /usr/local/bin/kubectl ]] && export KUBECTL_PORT_FORWARD="/usr/local/bin/kubectl --request-timeout=15s"
  [[ -z "${KUBECTL_PORT_FORWARD:-}" ]] && export KUBECTL_PORT_FORWARD="kubectl --request-timeout=15s"
fi
export HOST="${HOST:-off-campus-housing.test}"
export PORT="${PORT:-30443}"

# Pre-flight: validate DB & Cache once (quick check)
say "Pre-flight: DB & Cache validation"
if [[ -f "$SCRIPT_DIR/verify-db-cache-quick.sh" ]]; then
  PREFLIGHT_VERIFY_LOG="/tmp/preflight-db-cache-$$.log"
  VERIFY_LOG="$PREFLIGHT_VERIFY_LOG" "$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1
  PREFLIGHT_DB_RC=$?
  tail -20 "$PREFLIGHT_VERIFY_LOG" 2>/dev/null || true
  if [[ "$PREFLIGHT_DB_RC" -eq 0 ]]; then
    ok "DB & Cache pre-flight complete"
  else
    warn "DB & Cache pre-flight had failures (exit $PREFLIGHT_DB_RC); continuing (suites will run verification again)"
  fi
else
  warn "verify-db-cache-quick.sh not found; skipping pre-flight DB/cache"
fi

say "=== Running All Test Suites (gRPC + HTTP/2 + HTTP/3/QUIC) ==="
ok "Protocol coverage: gRPC (Envoy), HTTP/2 (Caddy TCP 443), HTTP/3/QUIC (Caddy UDP 443)"
ok "Packet capture: rotation, standalone-capture"
ok "TLS/mTLS: Comprehensive certificate chain, gRPC TLS, mTLS configuration"
ok "Auth: test-auth-service.sh (register, login, MFA, passkeys)"

SUITE_LOG_DIR="${SUITE_LOG_DIR:-/tmp/suite-logs-$(date +%s)}"
mkdir -p "$SUITE_LOG_DIR"
say "Suite logs: $SUITE_LOG_DIR"
say "All results will be piped to: $SUITE_LOG_DIR"
say "DB & Cache verification will run after EACH test suite (all 4 suites get verify-db-cache-quick.sh)"
info "Per-suite timeout: SUITE_TIMEOUT=${SUITE_TIMEOUT:-0}; when 0, safety cap SUITE_TIMEOUT_SAFETY=${SUITE_TIMEOUT_SAFETY:-7200}s so all 4 suites run (set SUITE_TIMEOUT_DISABLE_SAFETY=1 for no cap)."
info "To analyze results: cat $SUITE_LOG_DIR/*.log | grep -E '(✅|❌|⚠️|FAILED|error)'"

# Explicit timeout: set SUITE_TIMEOUT (seconds) to cap suites so the run progresses and exits (e.g. SUITE_TIMEOUT=3600 for 1h).
# When a suite hits the cap it is killed and marked timed out; remaining suites still run.
# When SUITE_TIMEOUT=0 (no cap), use SUITE_TIMEOUT_SAFETY (default 7200) so one suite cannot hang forever and block 2/9..9/9. Set SUITE_TIMEOUT_DISABLE_SAFETY=1 for true no-timeout.
SUITE_TIMEOUT="${SUITE_TIMEOUT:-0}"
SUITE_TIMEOUT_SAFETY="${SUITE_TIMEOUT_SAFETY:-7200}"
VERIFY_DB_CACHE_TIMEOUT="${VERIFY_DB_CACHE_TIMEOUT:-120}"
_run_suite() {
  local suite_name="${1:?missing suite name}" suite_script="${2:?missing script path}"
  local timeout_sec="${3:-0}"
  [[ "$timeout_sec" -eq 0 ]] && [[ -n "${ENHANCED_SUITE_TIMEOUT:-}" ]] && [[ "${ENHANCED_SUITE_TIMEOUT:-0}" -gt 0 ]] && [[ "$suite_name" == "enhanced" ]] && timeout_sec="$ENHANCED_SUITE_TIMEOUT"
  [[ "$timeout_sec" -eq 0 ]] && timeout_sec="${SUITE_TIMEOUT:-0}"
  if [[ "$timeout_sec" -eq 0 ]] && [[ "${SUITE_TIMEOUT_DISABLE_SAFETY:-0}" != "1" ]] && [[ "${SUITE_TIMEOUT_SAFETY:-0}" -gt 0 ]]; then
    timeout_sec="$SUITE_TIMEOUT_SAFETY"
  fi
  local suite_log="$SUITE_LOG_DIR/$suite_name.log"
  local verify_log="$SUITE_LOG_DIR/$suite_name-verification.log"
  local timing_file="$SUITE_LOG_DIR/suite-timing.txt"
  mkdir -p "$SUITE_LOG_DIR"
  echo "$suite_name start $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$timing_file"
  # Suite 2/4 (rotation) runs packet capture; timing here allows correlating capture window with this file.
  set +e
  set +u
  if [[ "$timeout_sec" -gt 0 ]]; then
    ( "$suite_script" 2>&1 | tee "$suite_log"; exit "${PIPESTATUS[0]:-0}" ) & local suite_pid=$!
    local waited=0
    while kill -0 "$suite_pid" 2>/dev/null && [[ $waited -lt "$timeout_sec" ]]; do sleep 5; waited=$((waited + 5)); done
    if kill -0 "$suite_pid" 2>/dev/null; then
      kill "$suite_pid" 2>/dev/null || true
      wait "$suite_pid" 2>/dev/null || true
      warn "$suite_name: TIMED OUT after ${timeout_sec}s (killed)"
      echo "" >> "$suite_log"
      echo "[Suite timed out after ${timeout_sec}s - partial output above]" >> "$suite_log"
      local rc=124
    else
      wait "$suite_pid" 2>/dev/null
      local rc=$?
      [[ $rc -eq 0 ]] || true
    fi
  else
    "$suite_script" 2>&1 | tee "$suite_log"
    local rc=${PIPESTATUS[0]}
  fi
  echo "$suite_name end $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$timing_file"
  set -u
  set -e

  # Run DB and cache verification after each suite (capped so it cannot block the next suite)
  say "Running DB & Cache verification after $suite_name..."
  export USER1_ID="${USER1_ID:-}"
  export USER2_ID="${USER2_ID:-}"
  export VERIFY_LOG="$verify_log"
  if [[ "${VERIFY_DB_CACHE_TIMEOUT:-0}" -gt 0 ]]; then
    ( "$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1 | tee "$verify_log"; exit "${PIPESTATUS[0]:-0}" ) &
    local verify_pid=$!
    local v_waited=0
    while kill -0 "$verify_pid" 2>/dev/null && [[ $v_waited -lt "$VERIFY_DB_CACHE_TIMEOUT" ]]; do
      sleep 5; v_waited=$((v_waited + 5))
      { [[ $v_waited -eq 5 ]] || [[ $((v_waited % 15)) -eq 0 ]]; } && info "  (DB verification in progress... ${v_waited}s)"
    done
    if kill -0 "$verify_pid" 2>/dev/null; then
      kill "$verify_pid" 2>/dev/null || true
      wait "$verify_pid" 2>/dev/null || true
      warn "DB & Cache verification timed out after ${VERIFY_DB_CACHE_TIMEOUT}s"
      echo "[Verification timed out after ${VERIFY_DB_CACHE_TIMEOUT}s]" >> "$verify_log"
    else
      wait "$verify_pid" 2>/dev/null || true
    fi
  else
    "$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1 | tee "$verify_log" || warn "Verification had issues"
  fi
  
  if [[ $rc -eq 0 ]]; then
    ok "$suite_name: PASSED"
    return 0
  fi
  warn "$suite_name: FAILED (exit $rc)"
  echo ""
  echo "--- Last 80 lines of $suite_name (root-cause) ---"
  [[ -f "$suite_log" ]] && [[ -s "$suite_log" ]] && tail -80 "$suite_log" || echo "(no log or empty)"
  echo "--- end $suite_name ---"
  # Quick diagnosis on failure/timeout
  say "Quick diagnosis (failed suite: $suite_name)..."
  local quick_log="$SUITE_LOG_DIR/quick-diag-$suite_name.log"
  if [[ -f "$SCRIPT_DIR/quick-pod-diagnostics.sh" ]]; then
    "$SCRIPT_DIR/quick-pod-diagnostics.sh" 2>&1 | tee "$quick_log" || true
    info "Quick diagnosis log: $quick_log"
  fi
  # Deep diagnosis (can be slow; run and append to log)
  say "Deep diagnosis (failed suite: $suite_name)..."
  local deep_log="$SUITE_LOG_DIR/deep-diag-$suite_name.log"
  if [[ -f "$SCRIPT_DIR/deep-dive-pod-diagnostics.sh" ]]; then
    "$SCRIPT_DIR/deep-dive-pod-diagnostics.sh" 2>&1 | tee "$deep_log" || true
    info "Deep diagnosis log: $deep_log"
  fi
  return 1
}

FAILED=0
FAILED_SUITES=()
SUITES_START_TIME=$(date +%s)
# Each _run_suite call uses "|| { FAILED+=1; FAILED_SUITES+=(...); }" so a failed suite does not exit the script — all 4 suites run.

# Prefer LB IP when host can reach it (MetalLB verification wrote USE_LB_FOR_TESTS=1); else NodePort or port-forward.
# Colima: MetalLB only. If metallb-reachable.env missing, derive TARGET_IP from caddy-h3 LoadBalancer.
CADDY_PF_PID=""
METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
if [[ -f "$METALLB_ENV" ]]; then
  # shellcheck source=/dev/null
  set -a && source "$METALLB_ENV" 2>/dev/null && set +a || true
fi
# Dynamic LB IP: MetalLB can reassign after Caddy rollout. Always use current value from cluster (never stale from env file).
_old_lb="${REACHABLE_LB_IP:-}"
if [[ -f "$SCRIPT_DIR/lib/resolve-lb-ip.sh" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/lib/resolve-lb-ip.sh" 2>/dev/null || true
fi
# Guarantee TARGET_IP = MetalLB IP when caddy-h3 is LoadBalancer (same as MetalLB EXTERNAL-IP)
if [[ -z "${TARGET_IP:-}" ]] && kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
  _lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [[ -n "$_lb_ip" ]]; then
    export TARGET_IP="$_lb_ip"
    export REACHABLE_LB_IP="$_lb_ip"
    export CADDY_LB_IP="$_lb_ip"
    info "TARGET_IP set from caddy-h3 LoadBalancer: $_lb_ip (MetalLB)"
  fi
fi
[[ -n "${CADDY_LB_IP:-}" ]] && [[ -n "$_old_lb" ]] && [[ "$CADDY_LB_IP" != "$_old_lb" ]] && info "LB IP updated: $_old_lb -> $CADDY_LB_IP (MetalLB may have reassigned)"
# EXTERNAL-IP <pending>: MetalLB has not assigned an IP. Fail fast with clear guidance.
if [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]] && [[ -z "${CADDY_LB_IP:-}" ]] && kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
  warn "caddy-h3 has EXTERNAL-IP <pending> — MetalLB has not assigned an IP. This is not TLS/CA."
  warn "  Run: ./scripts/diag-metallb-lb-pending.sh   (docs/METALLB_EXTERNAL_IP_PENDING_FIX.md)"
  [[ "${REQUIRE_LB_REACHABLE:-1}" == "1" ]] && exit 1
fi
# Colima/MetalLB: when we have LB IP (from resolve-lb-ip or env), always use PORT=443 — never NodePort.
# Split-brain fix: metallb-reachable.env may have USE_LB_FOR_TESTS=0 if verify ran before network ready; we still have TARGET_IP from resolve-lb-ip.
if [[ -n "${TARGET_IP:-}" ]] && [[ -n "${CADDY_LB_IP:-}" ]] && kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
  _was_port="${PORT:-}"
  export PORT=443
  export USE_LB_FOR_TESTS=1
  export REACHABLE_LB_IP="${TARGET_IP}"
  [[ -n "$_was_port" ]] && [[ "$_was_port" != "443" ]] && info "Forcing PORT=443 (LB IP path; was $_was_port)"
fi
if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]] && [[ -z "${TARGET_IP:-}" ]] && [[ -z "${REACHABLE_LB_IP:-}" ]]; then
  _lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [[ -n "$_lb_ip" ]]; then
    export TARGET_IP="$_lb_ip"
    export REACHABLE_LB_IP="$_lb_ip"
    export USE_LB_FOR_TESTS=1
    info "Colima: derived TARGET_IP=$_lb_ip from caddy-h3 (MetalLB only)"
  fi
fi
if [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]] && [[ -n "${REACHABLE_LB_IP:-}" ]]; then
  export TARGET_IP="$REACHABLE_LB_IP"
  export PORT="${PORT:-443}"
  _caddy_np=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null | tr -d '\n' || echo "30443")
  [[ -z "$_caddy_np" ]] && _caddy_np="30443"
  export CADDY_NODEPORT="$_caddy_np"
  say "LB IP primary: $REACHABLE_LB_IP (MetalLB only; no NodePort for tests)"
  # Wait for Caddy endpoints
  _ep_wait=0
  while [[ $_ep_wait -lt 30 ]]; do
    _addrs=$(kubectl -n ingress-nginx get endpoints caddy-h3 -o jsonpath='{.subsets[0].addresses[*].ip}' 2>/dev/null || echo "")
    [[ -n "$_addrs" ]] && break
    sleep 2
    _ep_wait=$((_ep_wait + 2))
  done
  [[ -n "$_addrs" ]] && ok "Caddy endpoints ready" || warn "Caddy has no ready endpoints; LB IP may fail (connection refused)"
  # Detect: is LB IP reachable (TCP 443)?
  _lb_code="000"
  _lb_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --http2 \
    --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" -H "Host: off-campus-housing.test" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null || echo "000")
  _setup_ran=0
  if [[ "$_lb_code" != "200" ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]]; then
    info "LB IP ${REACHABLE_LB_IP}:443 not reachable (got $_lb_code). Running setup-lb-ip-host-access.sh (TCP+UDP+bridge)..."
    if sudo -n true 2>/dev/null; then
      sudo env LB_IP="$REACHABLE_LB_IP" NODEPORT="$_caddy_np" "$SCRIPT_DIR/setup-lb-ip-host-access.sh" 2>/dev/null || true
    else
      LB_IP="$REACHABLE_LB_IP" NODEPORT="$_caddy_np" "$SCRIPT_DIR/setup-lb-ip-host-access.sh" 2>/dev/null || true
    fi
    _setup_ran=1
    sleep 2
    _lb_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --http2 \
      --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" -H "Host: off-campus-housing.test" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null || echo "000")
  fi
  if [[ "$_lb_code" != "200" ]]; then
    if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]]; then
      say "LB IP ${REACHABLE_LB_IP}:443 unreachable (got $_lb_code). Colima tests require LB IP (no NodePort fallback)."
      info "  Run: sudo LB_IP=$REACHABLE_LB_IP NODEPORT=$_caddy_np $SCRIPT_DIR/setup-lb-ip-host-access.sh"
      info "  For pods to reach Postgres: docker compose up -d && ./scripts/colima-apply-host-aliases.sh"
      if [[ "${REQUIRE_LB_REACHABLE:-1}" == "1" ]]; then
        fail "LB IP required for Colima tests. Fix LB reachability and re-run."
      fi
      warn "  Continuing with TARGET_IP=$REACHABLE_LB_IP (REQUIRE_LB_REACHABLE=0); suites will likely fail."
    else
      _np_code="000"
      _np_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --http2 \
        -H "Host: off-campus-housing.test" "https://127.0.0.1:$_caddy_np/_caddy/healthz" 2>/dev/null || echo "000")
      if [[ "$_np_code" == "200" ]]; then
        warn "LB IP still unreachable after setup. Run manually with sudo: LB_IP=$REACHABLE_LB_IP NODEPORT=$_caddy_np $SCRIPT_DIR/setup-lb-ip-host-access.sh. Using NodePort for this run."
        export PORT="$_caddy_np"
        export CADDY_NODEPORT="$_caddy_np"
        unset TARGET_IP
        USE_LB_FOR_TESTS=0
        export CAPTURE_TRAFFIC_TARGET="NodePort 127.0.0.1:$_caddy_np"
      else
        warn "Both LB IP (${_lb_code}) and NodePort (${_np_code}) failed. Using NodePort $_caddy_np so suites can run."
        info "  Run with sudo: LB_IP=$REACHABLE_LB_IP NODEPORT=$_caddy_np $SCRIPT_DIR/setup-lb-ip-host-access.sh"
        export PORT="$_caddy_np"
        export CADDY_NODEPORT="$_caddy_np"
        unset TARGET_IP
        USE_LB_FOR_TESTS=0
        export CAPTURE_TRAFFIC_TARGET="NodePort 127.0.0.1:$_caddy_np"
      fi
    fi
  else
    ok "LB IP ${REACHABLE_LB_IP}:443 reachable (TCP); primary for all suites"
    export CAPTURE_TRAFFIC_TARGET="LB IP ${REACHABLE_LB_IP}:443"
    # Probe HTTP/3 (--http3-only) before running setup; skip setup if already working (avoids second password prompt)
    _h3_ok=0
    _ca_h3="$REPO_ROOT/certs/dev-root.pem"
    [[ -f "$_ca_h3" ]] || _ca_h3="/tmp/grpc-certs/ca.crt"
    if [[ -f "$_ca_h3" ]]; then
      CURL_BIN="${CURL_BIN:-}"
      [[ -z "$CURL_BIN" ]] && [[ -x /opt/homebrew/opt/curl/bin/curl ]] && /opt/homebrew/opt/curl/bin/curl --help all 2>/dev/null | grep -q -- "--http3-only" && CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
      [[ -z "$CURL_BIN" ]] && CURL_BIN="curl"
      if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
        _h3_out=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --cacert "$_ca_h3" \
          --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null) || true
        [[ "${_h3_out:-000}" == "200" ]] && _h3_ok=1
      fi
      if [[ $_h3_ok -ne 1 ]] && [[ -f "$SCRIPT_DIR/lib/http3.sh" ]]; then
        source "$SCRIPT_DIR/lib/http3.sh" 2>/dev/null || true
        _h3_out=$(http3_curl --cacert "$_ca_h3" -sS -o /dev/null -w "%{http_code}" --max-time 10 --http3-only \
          --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null) || true
        [[ "${_h3_out:-000}" == "200" ]] && _h3_ok=1
      fi
    fi
    # Only run setup when HTTP/3 is not yet working (avoids redundant sudo prompt when 3c1b already ran setup)
    if [[ $_h3_ok -ne 1 ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]] && [[ "$_setup_ran" -eq 0 ]]; then
      info "HTTP/3 (--http3-only) to LB IP not OK. Ensuring UDP 443 and Docker bridge (run setup)..."
      if sudo -n true 2>/dev/null; then
        sudo env LB_IP="$REACHABLE_LB_IP" NODEPORT="$_caddy_np" "$SCRIPT_DIR/setup-lb-ip-host-access.sh" 2>/dev/null || true
      else
        LB_IP="$REACHABLE_LB_IP" NODEPORT="$_caddy_np" "$SCRIPT_DIR/setup-lb-ip-host-access.sh" 2>/dev/null || true
      fi
      _setup_ran=1
      sleep 2
      _h3_ok=0
      if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
        _h3_out=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --cacert "$_ca_h3" \
          --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null) || true
        [[ "${_h3_out:-000}" == "200" ]] && _h3_ok=1
      fi
      if [[ $_h3_ok -ne 1 ]] && [[ -f "$SCRIPT_DIR/lib/http3.sh" ]]; then
        source "$SCRIPT_DIR/lib/http3.sh" 2>/dev/null || true
        _h3_out=$(http3_curl --cacert "$_ca_h3" -sS -o /dev/null -w "%{http_code}" --max-time 10 --http3-only \
          --resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}" "https://off-campus-housing.test/_caddy/healthz" 2>/dev/null) || true
        [[ "${_h3_out:-000}" == "200" ]] && _h3_ok=1
      fi
      if [[ $_h3_ok -ne 1 ]]; then
        warn "HTTP/3 (--http3-only) to LB IP still failed after setup."
        info "  Root cause: k3d has not published UDP 30443 to the host. Recreate cluster: ./scripts/k3d-create-2-node-cluster.sh (includes --port 30443:30443/udp@server:0)."
        info "  Then run: LB_IP=$REACHABLE_LB_IP NODEPORT=$_caddy_np $SCRIPT_DIR/setup-lb-ip-host-access.sh"
      fi
    fi
    # Export Docker bridge port for HTTP/3 from containers (host.docker.internal:18443)
    _pid_dir="${TMPDIR:-/tmp}"
    _safe_lb=$(echo "$REACHABLE_LB_IP" | tr '.' '_')
    if [[ -f "$_pid_dir/lb-ip-docker-forward-port-${_safe_lb}.txt" ]]; then
      export DOCKER_FORWARD_PORT=$(cat "$_pid_dir/lb-ip-docker-forward-port-${_safe_lb}.txt" 2>/dev/null | tr -d '\n' || echo "18443")
    else
      export DOCKER_FORWARD_PORT="${DOCKER_FORWARD_PORT:-18443}"
    fi
    [[ -n "${DOCKER_FORWARD_PORT:-}" ]] && info "Docker bridge port: ${DOCKER_FORWARD_PORT} (HTTP/3 from containers via host.docker.internal:${DOCKER_FORWARD_PORT})"
    if [[ $_h3_ok -eq 1 ]]; then
      ok "HTTP/3 (QUIC) to LB IP OK; suites will use LB IP"
    else
      info "HTTP/3 to LB IP not verified; see root cause above if QUIC fails"
    fi
  fi
else
  USE_LB_FOR_TESTS=0
fi

# On k3d: when not using LB IP, prefer NodePort 30443 if reachable (HTTP/2 + HTTP/3). Else fall back to TCP port-forward (HTTP/2 only).
# Do NOT run "k3d cluster edit --port-add" here: it can fail with "address already in use" and break the cluster (serverlb replace). Use scripts/k3d-fix-30443-or-recover.sh or recreate cluster with k3d-create-2-node-cluster.sh.
if [[ "$ctx" == *"k3d"* ]] && [[ "${USE_LB_FOR_TESTS:-0}" != "1" ]]; then
  say "k3d: checking Caddy reachability (NodePort 30443 for HTTP/2 + HTTP/3)..."
  _code="000"
  _code=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --http2 \
    -H "Host: off-campus-housing.test" "https://127.0.0.1:30443/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$_code" == "200" ]]; then
    export PORT=30443
    export CADDY_NODEPORT=30443
    trap '[[ -n "${CADDY_PF_PID:-}" ]] && kill $CADDY_PF_PID 2>/dev/null || true' EXIT
    # Root cause: k3d --port defaults to TCP only; HTTP/3 (QUIC) needs UDP. Verify before claiming.
    _h3_ok=0
    _ca="$REPO_ROOT/certs/dev-root.pem"
    [[ -f "$_ca" ]] || _ca="/tmp/grpc-certs/ca.crt"
    if [[ -f "$_ca" ]] && [[ -f "$SCRIPT_DIR/lib/http3.sh" ]]; then
      # shellcheck source=scripts/lib/http3.sh
      source "$SCRIPT_DIR/lib/http3.sh" 2>/dev/null || true
      _h3_code="000"
      _h3_out=$(http3_curl --cacert "$_ca" -sS -o /dev/null -w "%{http_code}" --max-time 5 --http3-only \
        -H "Host: off-campus-housing.test" "https://127.0.0.1:30443/_caddy/healthz" 2>/dev/null) || true
      _h3_code="${_h3_out:-000}"
      [[ "$_h3_code" == "200" ]] && _h3_ok=1
    fi
    export CAPTURE_TRAFFIC_TARGET="NodePort 127.0.0.1:30443"
    if [[ "${_h3_ok}" == "1" ]]; then
      ok "NodePort 30443 reachable; PORT=30443 (HTTP/2 + HTTP/3/QUIC work)"
    else
      ok "NodePort 30443 reachable; PORT=30443 (HTTP/2 only; HTTP/3 requires UDP 30443)"
      say "Fix HTTP/3 (QUIC) on NodePort:"
      info "  k3d must publish UDP 30443. Recreate cluster: ./scripts/k3d-create-2-node-cluster.sh (includes --port 30443:30443/udp@server:0)"
      info "  Or run: ./scripts/k3d-fix-30443-or-recover.sh (option C: RECREATE=1). For LB IP path: sudo LB_IP=<ip> NODEPORT=30443 $SCRIPT_DIR/setup-lb-ip-host-access.sh"
    fi
  else
    say "k3d: NodePort 30443 not reachable; starting Caddy port-forward (8443:443) for HTTP/2 only..."
    kubectl port-forward -n ingress-nginx svc/caddy-h3 8443:443 --request-timeout=5s 2>/dev/null & CADDY_PF_PID=$!
    sleep 4
    export PORT=8443
    export CADDY_NODEPORT=8443
    trap '[[ -n "${CADDY_PF_PID:-}" ]] && kill $CADDY_PF_PID 2>/dev/null || true' EXIT
    ok "PORT=8443 (port-forward active; HTTP/2 only; HTTP/3 will fail)"
    info "For HTTP/3 on k3d: recreate cluster with ./scripts/k3d-create-2-node-cluster.sh (includes 30443), or see scripts/k3d-fix-30443-or-recover.sh"
  fi
fi

# Export traffic target for packet capture and logs (rotation, standalone-capture report NodePort vs LB IP)
if [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]] && [[ -n "${REACHABLE_LB_IP:-}" ]] && [[ "${PORT:-443}" == "443" ]]; then
  export CAPTURE_TRAFFIC_TARGET="LB IP ${REACHABLE_LB_IP}:443"
else
  export CAPTURE_TRAFFIC_TARGET="NodePort ${TARGET_IP:-127.0.0.1}:${PORT:-30443}"
fi

# Make it clear: strict TLS/mTLS and HTTP/3 policy (packet capture and suites use this target)
say "Suite run policy: strict TLS/mTLS enforced (CA cert, no -k); HTTP/3 uses --http3-only (no HTTP/2 fallback)"
info "Traffic target: $CAPTURE_TRAFFIC_TARGET — packet capture and all suites use this IP and port"

# Readiness gate: ensure Caddy + api-gateway + housing services are ready and grace delay (avoids 504, 404, curl 28 during rotation)
if [[ -f "$SCRIPT_DIR/ensure-readiness-before-suites.sh" ]] && [[ "${SKIP_READINESS_GATE:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/ensure-readiness-before-suites.sh" 2>/dev/null || true
  "$SCRIPT_DIR/ensure-readiness-before-suites.sh" || warn "Readiness gate had issues (continuing)"
fi

# 1. Auth service (housing: register, login, MFA, passkeys)
say "1/4: Auth service"
if [[ -f "$SCRIPT_DIR/test-auth-service.sh" ]]; then
  _run_suite "auth" "$SCRIPT_DIR/test-auth-service.sh" || { FAILED=$((FAILED + 1)); FAILED_SUITES+=(auth); }
else
  warn "test-auth-service.sh not found; skipping auth suite"
fi

# 2. Rotation suite (CA/leaf rotation + wire-level capture + protocol verification)
# ROTATION_UPDATE_KAFKA_SSL=1 so Kafka TLS is regenerated after CA rotation.
# ROTATION_SKIP_KEYCHAIN_TRUST=1 so macOS keychain is not updated; k6/ConfigMap use certs/dev-root.pem.
# ROTATION_H2_KEYLOG=1 (default): k6 on host with SSLKEYLOGFILE → decrypted HTTP/2 frames in wire verification.
# ROTATE_CA=1 (default): rotate CA and leaf for full cert chain test.
say "2/4: Rotation suite"
export ROTATION_UPDATE_KAFKA_SSL=1
export ROTATION_SKIP_KEYCHAIN_TRUST=1
export ROTATION_H2_KEYLOG="${ROTATION_H2_KEYLOG:-1}"
export ROTATE_CA="${ROTATE_CA:-1}"
export ROTATION_UDP_STATS="${ROTATION_UDP_STATS:-0}"
[[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && info "  ROTATION_UDP_STATS=1: UDP stats (netstat/ss) pre/post → \$WIRE_CAPTURE_DIR"
_run_suite "rotation" "$SCRIPT_DIR/rotation-suite.sh" || { FAILED=$((FAILED + 1)); FAILED_SUITES+=(rotation); }

# 2b. k6 load phase *after* CA/leaf rotation — proves traffic works with the new cert (strict TLS only; trust certs/dev-root.pem).
# Order: rotation updates certs/dev-root.pem → k6 uses that CA so we never skip TLS verification.
if [[ "${RUN_K6:-0}" == "1" ]] && command -v k6 >/dev/null 2>&1; then
  say "5b. k6 load (after CA/leaf rotation; strict TLS — trust certs/dev-root.pem to prove new cert works)"
  if [[ -z "${K6_SUITE_RESOURCE_LOG:-}" ]] && [[ "${K6_SUITE_RESOURCE_LOG_AUTO:-1}" == "1" ]]; then
    if [[ -n "${PREFLIGHT_RUN_DIR:-}" ]]; then
      export K6_SUITE_RESOURCE_LOG="$PREFLIGHT_RUN_DIR/k6-suite-resources-run-all.log"
    else
      export K6_SUITE_RESOURCE_LOG="$REPO_ROOT/bench_logs/k6-suite-resources-$(date +%Y%m%d-%H%M%S).log"
    fi
    mkdir -p "$(dirname "$K6_SUITE_RESOURCE_LOG")"
    {
      echo "# run-all-test-suites — k6 kubectl top snapshots (contention evidence)"
      echo "# $(date -Iseconds)"
    } >>"$K6_SUITE_RESOURCE_LOG"
    info "k6 resource snapshots also appended to: $K6_SUITE_RESOURCE_LOG"
  fi
  if [[ "${K6_SUITE_STABILITY_AGGRESSIVE:-0}" == "1" ]]; then
    export K6_SUITE_RESTART_ENVOY_AFTER_CAR="${K6_SUITE_RESTART_ENVOY_AFTER_CAR:-1}"
    info "K6_SUITE_STABILITY_AGGRESSIVE=1 → K6_SUITE_RESTART_ENVOY_AFTER_CAR=${K6_SUITE_RESTART_ENVOY_AFTER_CAR}"
  fi
  K6_CA_ROOT="$(cd "$REPO_ROOT" 2>/dev/null && pwd)/certs/dev-root.pem"
  mkdir -p "$(dirname "$K6_CA_ROOT")"
  # If rotation didn't sync certs/dev-root.pem (e.g. k3d path), try once to populate from K8s so k6 has a CA
  if [[ ! -f "$K6_CA_ROOT" ]] || [[ ! -s "$K6_CA_ROOT" ]]; then
    kubectl -n off-campus-housing-tracker get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$K6_CA_ROOT" 2>/dev/null && [[ -s "$K6_CA_ROOT" ]] && info "Fetched CA from off-campus-housing-tracker secret to certs/dev-root.pem" || true
    [[ ! -s "$K6_CA_ROOT" ]] && kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$K6_CA_ROOT" 2>/dev/null && [[ -s "$K6_CA_ROOT" ]] && info "Fetched CA from ingress-nginx secret to certs/dev-root.pem" || true
  fi
  _k6_abs() { local f="$1"; [[ -z "$f" ]] || [[ ! -f "$f" ]] && return 1; echo "$(cd "$(dirname "$f")" 2>/dev/null && pwd)/$(basename "$f")"; }
  _k6_extract_to_repo_root() {
    local out="$1"
    kubectl -n off-campus-housing-tracker get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$out" 2>/dev/null && [[ -s "$out" ]] && return 0
    kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$out" 2>/dev/null && [[ -s "$out" ]] && return 0
    if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      local b64
      b64=$(colima ssh -- kubectl -n off-campus-housing-tracker get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' --request-timeout=10s 2>/dev/null || true)
      [[ -n "$b64" ]] && echo "$b64" | base64 -d > "$out" 2>/dev/null && [[ -s "$out" ]] && return 0
      b64=$(colima ssh -- kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' --request-timeout=10s 2>/dev/null || true)
      [[ -n "$b64" ]] && echo "$b64" | base64 -d > "$out" 2>/dev/null && [[ -s "$out" ]] && return 0
    fi
    return 1
  }
  K6_CA_ABSOLUTE=""
  # Prefer certs/dev-root.pem (rotation suite syncs the new CA here)
  if [[ -f "$K6_CA_ROOT" ]] && [[ -s "$K6_CA_ROOT" ]]; then
    K6_CA_ABSOLUTE="$(_k6_abs "$K6_CA_ROOT")"
    [[ -n "$K6_CA_ABSOLUTE" ]] && info "Strict TLS: using CA at certs/dev-root.pem (post-rotation; SSL_CERT_FILE=$K6_CA_ABSOLUTE)"
  fi
  if [[ -z "$K6_CA_ABSOLUTE" ]] && [[ -n "${K6_CA_CERT:-}" ]] && [[ -f "$K6_CA_CERT" ]] && [[ -s "$K6_CA_CERT" ]]; then
    K6_CA_ABSOLUTE="$(_k6_abs "$([[ "$K6_CA_CERT" = /* ]] && echo "$K6_CA_CERT" || echo "$REPO_ROOT/$K6_CA_CERT")")"
    [[ -n "$K6_CA_ABSOLUTE" ]] && info "Strict TLS: using K6_CA_CERT (SSL_CERT_FILE=$K6_CA_ABSOLUTE)"
  fi
  if [[ -z "$K6_CA_ABSOLUTE" ]] && _k6_extract_to_repo_root "$K6_CA_ROOT"; then
    K6_CA_ABSOLUTE="$(_k6_abs "$K6_CA_ROOT")"
    [[ -n "$K6_CA_ABSOLUTE" ]] && info "Strict TLS: extracted dev-root-ca to repo root (SSL_CERT_FILE=$K6_CA_ABSOLUTE)"
  fi
  if [[ -z "$K6_CA_ABSOLUTE" ]] && [[ -s /tmp/grpc-certs/ca.crt ]]; then
    cp -f /tmp/grpc-certs/ca.crt "$K6_CA_ROOT" 2>/dev/null && true
    K6_CA_ABSOLUTE="$(_k6_abs "$K6_CA_ROOT")"
    [[ -z "$K6_CA_ABSOLUTE" ]] && K6_CA_ABSOLUTE="$(_k6_abs "/tmp/grpc-certs/ca.crt")"
    [[ -n "$K6_CA_ABSOLUTE" ]] && info "Strict TLS: using CA from /tmp/grpc-certs (SSL_CERT_FILE=$K6_CA_ABSOLUTE)"
  fi
  # After rotation we never skip TLS — strict TLS/mTLS only (prove the cert works)
  export K6_INSECURE_SKIP_TLS=0
  K6_SCRIPT="${K6_SCRIPT:-$SCRIPT_DIR/load/k6-reads.js}"
  K6_DURATION="${K6_DURATION:-30s}"
  K6_VUS="${K6_VUS:-20}"
  HOST="${HOST:-off-campus-housing.test}"
  PORT="${PORT:-30443}"
  # From host: use hostname + K6_RESOLVE (never raw IP — cert SAN is off-campus-housing.test, not MetalLB IP)
  if [[ -z "${BASE_URL:-}" ]] && [[ "${K6_IN_CLUSTER:-0}" != "1" ]] && command -v kubectl >/dev/null 2>&1; then
    LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    if [[ -n "$LB_IP" ]]; then
      export BASE_URL="https://${HOST}:443"
      export K6_RESOLVE="${HOST}:443:${LB_IP}"
      info "k6 BASE_URL=$BASE_URL --resolve $K6_RESOLVE (strict TLS, SAN matches)"
    fi
  fi
  if [[ -n "$K6_CA_ABSOLUTE" ]] && [[ -s "$K6_CA_ABSOLUTE" ]]; then
    export SSL_CERT_FILE="$K6_CA_ABSOLUTE"
    info "k6 strict TLS: SSL_CERT_FILE=$K6_CA_ABSOLUTE"
    # macOS: add dev CA to keychain (replaces manual Keychain Access → Import → Always Trust). Do this so k6/curl/browser trust off-campus-housing.test and we avoid x509.
    if [[ "$(uname -s)" == "Darwin" ]] && [[ -f "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" ]]; then
      info "Trust dev CA on this machine (macOS keychain)…"
      "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" || true
    fi
    if [[ -n "${K6_PHASES:-}" ]] && [[ -f "$SCRIPT_DIR/load/run-k6-phases.sh" ]]; then
      # Default HTTP/3 (xk6-http3) on when running phases — multi-protocol without extra flags
      _k6_http3="${K6_HTTP3:-1}"
      _k6_http3_phases="${K6_HTTP3_PHASES:-1}"
      SUITE_LOG_DIR="$SUITE_LOG_DIR" K6_CA_ABSOLUTE="$K6_CA_ABSOLUTE" HOST="$HOST" PORT="$PORT" \
        K6_DURATION="$K6_DURATION" K6_VUS="$K6_VUS" K6_PHASES="$K6_PHASES" K6_HTTP3="$_k6_http3" K6_HTTP3_PHASES="$_k6_http3_phases" K6_INSECURE_SKIP_TLS=0 \
        "$SCRIPT_DIR/load/run-k6-phases.sh" || warn "k6 phases had issues"
      ok "k6 phases complete after rotation (logs: $SUITE_LOG_DIR/k6-*.log)"
    else
      _k6_base="${BASE_URL:-https://${HOST}:${PORT}}"
      _k6_resolve=()
      [[ -n "${K6_RESOLVE:-}" ]] && _k6_resolve=(--resolve "$K6_RESOLVE") || true
      k6_suite_before_k6_block "k6-post-rotation-single-load"
      ( env SSL_CERT_FILE="$K6_CA_ABSOLUTE" BASE_URL="$_k6_base" MODE=rate RATE=50 DURATION="$K6_DURATION" VUS="$K6_VUS" \
        k6 run "${_k6_resolve[@]}" "$K6_SCRIPT" 2>&1 | tee "$SUITE_LOG_DIR/k6-load.log" ) || warn "k6 load had issues"
      k6_suite_after_k6_block "k6-post-rotation-single" 1 || warn "k6 suite resource hook failed (node CPU ≥ threshold or cooldown)"
      ok "k6 load complete after rotation (log: $SUITE_LOG_DIR/k6-load.log)"
    fi
  else
    warn "k6 skipped after rotation: no CA (certs/dev-root.pem or K6_CA_CERT). Rotation suite syncs CA to certs/dev-root.pem."
  fi
fi

# 3. Standalone packet capture (gRPC + HTTP/2 + HTTP/3 wire capture only)
say "3/4: Standalone packet capture"
_run_suite "standalone-capture" "$SCRIPT_DIR/test-packet-capture-standalone.sh" || { FAILED=$((FAILED + 1)); FAILED_SUITES+=(standalone-capture); }

# 4. TLS/mTLS comprehensive test (cert chain, gRPC TLS, mTLS)
say "4/4: TLS/mTLS comprehensive test"
_run_suite "tls-mtls" "$SCRIPT_DIR/test-tls-mtls-comprehensive.sh" || { FAILED=$((FAILED + 1)); FAILED_SUITES+=(tls-mtls); }

SUITES_END_TIME=$(date +%s)
SUITES_ELAPSED=$((SUITES_END_TIME - SUITES_START_TIME))
say "=== All Test Suites Complete ==="
echo ""
info "All 4 suites have finished (auth, rotation, standalone-capture, tls-mtls). Total time: ${SUITES_ELAPSED}s. Exit code reflects failures only."
echo ""

# Run comprehensive database and cache verification (end-stage). Skip by default so full suite + enhanced/adversarial can run through; set SKIP_END_VERIFICATION=0 to run.
if [[ "${SKIP_END_VERIFICATION:-1}" == "0" ]] && [[ -f "$SCRIPT_DIR/verify-db-and-cache-comprehensive.sh" ]]; then
  say "Running comprehensive DB & Cache verification (verify-db-and-cache-comprehensive.sh)..."
  export USER1_ID="${USER1_ID:-}"
  export USER2_ID="${USER2_ID:-}"
  export HOST="${HOST:-off-campus-housing.test}"
  export PORT="${PORT:-30443}"
  "$SCRIPT_DIR/verify-db-and-cache-comprehensive.sh" 2>&1 | tee "$SUITE_LOG_DIR/comprehensive-verification.log" || warn "Comprehensive verification had issues"
  ok "Comprehensive verification complete (log: $SUITE_LOG_DIR/comprehensive-verification.log)"
elif [[ "${SKIP_END_VERIFICATION:-1}" == "1" ]]; then
  info "End-stage DB/cache verification skipped (SKIP_END_VERIFICATION=1). Set SKIP_END_VERIFICATION=0 to run verify-db-and-cache-comprehensive.sh"
fi

# k6 runs after rotation (step 5b); strict TLS only (trust certs/dev-root.pem).

if [[ $FAILED -eq 0 ]]; then
  ok "All suites passed (gRPC + HTTP/2 + HTTP/3/QUIC + TLS/mTLS)"
  exit 0
else
  warn "$FAILED suite(s) failed"
  echo ""
  say "=== Error Summary (only suites that exited non-zero) ==="
  info "Reached end of all suites; exiting with failure (one or more suites failed)."
  echo "Failed suites:"
  for suite_name in "${FAILED_SUITES[@]:-}"; do
    [[ -z "$suite_name" ]] && continue
    suite_log="$SUITE_LOG_DIR/$suite_name.log"
    if [[ -f "$suite_log" ]]; then
      echo "  ❌ $suite_name"
      echo "    Key issues:"
      grep -iE "error|failed|exit [1-9]|curl exit 77|SSL certificate|TLS.*failed|local: can only be used|context deadline exceeded|dial.*failed|Session open refused|mux_client_request_session|h3_fail|404.*purchase" "$suite_log" 2>/dev/null | head -8 | sed 's/^/      - /' || echo "      (see full log: $suite_log)"
      # Known root causes (see docs/PREFLIGHT_FAILURE_INVESTIGATION.md)
      if [[ "$suite_name" == "rotation" ]]; then
        echo "    Likely causes: k6 HTTP/3 100% fail (stale QUIC / timeout), or SSH mux (Session open refused). Use ROTATION_H2_KEYLOG=0 for in-cluster k6, or K6_HTTP3_NO_REUSE=1 for host k6."
      fi
    fi
  done
  echo ""
  say "=== Next Steps ==="
  echo "1. Review failed suite logs in: $SUITE_LOG_DIR"
  echo "2. Review comprehensive verification (if run): $SUITE_LOG_DIR/comprehensive-verification.log (set SKIP_END_VERIFICATION=0 to enable)"
  echo "3. Common issues (by layer):"
  echo "   - Protocol: HTTP/3 (curl exit 77) = CA/cert chain; HTTP/2 = TLS/caddy"
  echo "   - DB: Connection refused / schema = Postgres ports 5441–5448 (external Docker; ensure Docker Compose Postgres is up)"
  echo "   - Gateway/upstream: 502 = api-gateway→service (pod health, DNS, TLS, or service→DB)"
  echo "   - gRPC: Envoy routing / TLS = Envoy + service TLS mounts"
  echo "   - Cache: Redis (externalized) = port ${REDIS_PORT:-6380}, Lua"
  echo "   - Rotation: Secret updates (use colima ssh kubectl if host cannot reach API); cert reissue; packet capture: tcpdump/tshark on Caddy/Envoy"
  echo "   - Strict TLS/mTLS: test-tls-mtls-comprehensive.sh; packet capture: rotation, standalone-capture"
  if [[ -f "$SUITE_LOG_DIR/rotation.log" ]] && grep -q 'Protocol mismatch: expected HTTP/3, got ""' "$SUITE_LOG_DIR/rotation.log" 2>/dev/null; then
    echo "   - Rotation H3 proto empty: xk6-http3 was not exposing protocol to JS. Rebuild host k6 (and image if using in-cluster):"
    echo "     ./scripts/build-k6-http3.sh   # host binary used when ROTATION_H2_KEYLOG=1"
    echo "     ./scripts/build-k6-image.sh  # if using in-cluster k6 (ROTATION_H2_KEYLOG=0)"
    echo "     Then re-run: $SCRIPT_DIR/rotation-suite.sh"
  fi
  if [[ "${RUN_K6:-0}" == "1" ]] && [[ -f "$SUITE_LOG_DIR/k6-load.log" ]]; then
    if grep -qiE 'x509|certificate is not trusted' "$SUITE_LOG_DIR/k6-load.log" 2>/dev/null; then
      echo "   - k6 TLS: x509/certificate issues in $SUITE_LOG_DIR/k6-load.log"
      if [[ "$(uname -s)" == "Darwin" ]]; then
        echo "     On macOS we add the CA to keychain automatically; if x509 persists, run once:"
        echo "       $SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh $REPO_ROOT/certs/dev-root.pem"
        echo "     Or Keychain Access → File → Import → certs/dev-root.pem → double-click cert → Trust → Always Trust"
      else
        echo "     Set SSL_CERT_FILE to certs/dev-root.pem or run full preflight"
      fi
    fi
  fi
  echo ""
  echo "4. To re-run a specific suite:"
  echo "   $SCRIPT_DIR/test-auth-service.sh  # auth"
  echo "   $SCRIPT_DIR/rotation-suite.sh  # rotation"
  echo "   $SCRIPT_DIR/test-packet-capture-standalone.sh  # standalone-capture"
  echo "   $SCRIPT_DIR/test-tls-mtls-comprehensive.sh  # tls-mtls"
  echo ""
  echo "5. Load tests (strict TLS): RUN_K6=1 runs k6 after rotation. CA: certs/dev-root.pem. If k6 shows x509: run full preflight first, or set K6_CA_CERT=$REPO_ROOT/certs/dev-root.pem."
  echo ""
  warn "Exiting with code 1 (one or more suites failed)."
  exit 1
fi
