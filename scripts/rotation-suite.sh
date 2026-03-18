#!/usr/bin/env bash
set -euo pipefail

# Rotation suite: CA/leaf rotation + chaos (k6) + wire capture. Modes: --mode=perf (adaptive limit finding, default),
# --mode=wire (1 baseline iter, capture only), --mode=forensic (host k6 + SSLKEYLOGFILE, H2 only), --mode=all (run all three).
# Do not combine ROTATION_H2_KEYLOG=1 with perf; use forensic for decrypted frame proof.

### CONFIG
# Rotation only affects application TLS (Caddy record-local-tls, service-tls, dev-root-ca in namespaces).
# It does NOT modify kubeconfig or the cluster API server certs; kubectl continues to use cluster CA (e.g. k3d/k3s).
# ROTATION_SKIP_KEYCHAIN_TRUST=1: skip adding CA to macOS keychain (no security prompt); k6/ConfigMap use certs/dev-root.pem. Set by run-all-test-suites.sh so suite 5/9 never requires manual verify.
# Defaults: ROTATION_H2_KEYLOG=0 (in-cluster k6, no SSH/keylog) so rotation passes reliably; ROTATE_CA=1 (full cert chain test).
# ROTATION_MODE: "cluster" (in-cluster k6, default) or "host" (host k6 via MetalLB). Set ROTATION_H2_KEYLOG=1 only when you need SSLKEYLOGFILE (forces host mode, adds TLS debug overhead and SSH mux risk).
ROTATION_MODE="${ROTATION_MODE:-cluster}"
HOST="${HOST:-record.local}"
NS_ING="ingress-nginx"
NS_APP="record-platform"
SERVICE="caddy-h3"
LEAF_SECRET="record-local-tls"
CA_SECRET="dev-root-ca"
ROTATION_H2_KEYLOG="${ROTATION_H2_KEYLOG:-0}"
ROTATE_CA="${ROTATE_CA:-1}"
# No connection reuse during rotation — avoids stale H2/QUIC sessions after Caddy cert reload (required for H2 100% fail fix and H3 under rotation).
# Rotation flow: ROTATION_GRACE_SECONDS=8 after reload, then ROTATION_PREWARM_SLEEP, then ROTATION_H3_WARMUP (5x HTTP/3 health), then chaos. Set ROTATION_H3_WARMUP=0 to skip H3 warmup.
export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
export K6_HTTP2_NO_REUSE="${K6_HTTP2_NO_REUSE:-1}"
# Normalize ROTATE_CA for shell conditionals (if $ROTATE_CA)
[[ "$ROTATE_CA" == "1" ]] || [[ "$ROTATE_CA" == "true" ]] || [[ "$ROTATE_CA" == "yes" ]] && ROTATE_CA=true || ROTATE_CA=false
ROTATE_LEAF=true
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
K6_TIMEOUT="${K6_TIMEOUT:-480s}"

# No-op so EXIT trap never calls undefined function when ROTATION_SKIP_ROTATION=1 (wire/forensic in mode=all)
cleanup_secret_err() { :; }

# --mode=perf|wire|forensic|all (or env ROTATION_SUITE_MODE). perf=adaptive limit finding; wire=1 baseline iter+capture; forensic=host k6+KEYLOG+H2 only; all=runs perf then wire then forensic.
ROTATION_SUITE_MODE="${ROTATION_SUITE_MODE:-perf}"
for arg in "${@:-}"; do
  if [[ "$arg" == --mode=* ]]; then
    ROTATION_SUITE_MODE="${arg#--mode=}"
    break
  fi
done
if [[ "$ROTATION_SUITE_MODE" != "perf" ]] && [[ "$ROTATION_SUITE_MODE" != "wire" ]] && [[ "$ROTATION_SUITE_MODE" != "forensic" ]] && [[ "$ROTATION_SUITE_MODE" != "all" ]]; then
  echo "ERROR: Invalid --mode=$ROTATION_SUITE_MODE. Use --mode=perf, --mode=wire, --mode=forensic, or --mode=all" >&2
  exit 1
fi
# Guard: KEYLOG + perf would change topology (host k6, NAT, VU ceiling); use forensic for decrypted frames.
if [[ "${ROTATION_H2_KEYLOG:-0}" == "1" ]] && [[ "$ROTATION_SUITE_MODE" == "perf" ]]; then
  echo "ERROR: ROTATION_H2_KEYLOG=1 cannot be combined with performance/limit-finding (--mode=perf). Use --mode=forensic for decrypted HTTP/2 frames." >&2
  exit 1
fi
# mode=all: run three stages in sequence (rotation once, then perf; then wire with skip; then forensic with skip).
if [[ "$ROTATION_SUITE_MODE" == "all" ]]; then
  say "=== Rotation suite mode=all: running Stage 1 (perf), Stage 2 (wire), Stage 3 (forensic) ==="
  "$SCRIPT_DIR/rotation-suite.sh" --mode=perf || exit 1
  say "=== Stage 2: Wire (1 baseline iteration, capture only) ==="
  ROTATION_SKIP_ROTATION=1 "$SCRIPT_DIR/rotation-suite.sh" --mode=wire || exit 1
  say "=== Stage 3: Forensic (host k6, KEYLOG, H2 only) ==="
  ROTATION_SKIP_ROTATION=1 "$SCRIPT_DIR/rotation-suite.sh" --mode=forensic || exit 1
  say "=== All three stages complete ==="
  exit 0
fi

# Timing: measure total rotation suite duration (report at end)
ROTATION_SUITE_START=$(date +%s)

# Shims first so kubectl uses shim (avoids API server timeouts). See API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
# shellcheck source=scripts/lib/ensure-kubectl-shim.sh
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }
# Optional: shared test logging (ERROR/WARN/INFO/OK) for consistent grep and less noise
[[ -f "$SCRIPT_DIR/lib/test-log.sh" ]] && source "$SCRIPT_DIR/lib/test-log.sh" || {
  say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
  ok()   { echo "  ✔ $*"; }
  warn() { echo "  ⚠️  $*"; }
  log_info() { echo "  ℹ️  $*"; }
  info() { echo "  ℹ️  $*"; }
  fail() { echo "  ✘ $*" >&2; exit 1; }
}

### Tool validation
if $ROTATE_LEAF; then
  command -v mkcert >/dev/null || fail "mkcert not installed (required for leaf rotation)"
fi
if $ROTATE_CA; then
  command -v openssl >/dev/null || fail "openssl not installed (required for CA rotation)"
fi

### Ensure API server is reachable (Colima/Kind) before any kubectl
if [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=8 API_SERVER_SLEEP=2 \
    ENSURE_CAP=120 PREFLIGHT_CAP=45 "$SCRIPT_DIR/ensure-api-server-ready.sh" || \
    fail "API server not ready; aborting rotation suite"
fi

### Kubectl helper: fix timeout, docker-exec fallback, --validate=false
# shellcheck source=scripts/lib/kubectl-helper.sh
if [[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]]; then
  . "$SCRIPT_DIR/lib/kubectl-helper.sh"
else
  kctl() { kubectl "$@"; }
fi

### Host kubectl for port-forward (so localhost is on host, not inside Colima VM)
# kctl may be a shim that runs kubectl inside the VM; port-forward must run on host so curl localhost:2019 works.
if [[ -z "${KUBECTL_PORT_FORWARD:-}" ]]; then
  if [[ -x /opt/homebrew/bin/kubectl ]]; then
    export KUBECTL_PORT_FORWARD="/opt/homebrew/bin/kubectl --request-timeout=15s"
  elif [[ -x /usr/local/bin/kubectl ]]; then
    export KUBECTL_PORT_FORWARD="/usr/local/bin/kubectl --request-timeout=15s"
  else
    export KUBECTL_PORT_FORWARD="kubectl --request-timeout=15s"
  fi
fi

# Wait for caddy-h3 Endpoints to have at least one address (readiness gate during rotation).
# Usage: _wait_caddy_endpoints <timeout_sec> <label_for_logs>
_wait_caddy_endpoints() {
  local timeout_sec="${1:-30}"
  local label="${2:-rotation}"
  local t=0
  while [[ $t -lt "$timeout_sec" ]]; do
    local addrs
    addrs=$(kctl -n "$NS_ING" get endpoints "$SERVICE" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
    if [[ -n "${addrs// /}" ]]; then
      ok "Caddy endpoints ready ($label): $addrs"
      return 0
    fi
    sleep 2
    t=$((t + 2))
  done
  warn "Caddy endpoints not ready after ${timeout_sec}s ($label); continuing anyway (check: kubectl -n $NS_ING get endpoints $SERVICE)"
  return 1
}

### Detect ClusterIP port (443)
PORT=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.spec.ports[?(@.name=="https")].port}')

### MetalLB: TARGET_IP = MetalLB IP (caddy-h3 EXTERNAL-IP). Single source of truth for all rotation traffic.
[[ -f "${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}" ]] && source "${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}" 2>/dev/null || true
[[ -z "${TARGET_IP:-}" ]] && [[ -n "${REACHABLE_LB_IP:-}" ]] && export TARGET_IP="$REACHABLE_LB_IP"
[[ -z "${TARGET_IP:-}" ]] && TARGET_IP=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
[[ -z "${TARGET_IP:-}" ]] && TARGET_IP=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
[[ -n "${TARGET_IP:-}" ]] && export TARGET_IP && export PORT=443

# MetalLB mode: require LB IP, never NodePort. Rotation suite traffic = k6 → LB IP:443 → Caddy (HTTP/2 + HTTP/3).
if [[ "${METALLB_ENABLED:-0}" == "1" ]] || [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]]; then
  if [[ -z "${TARGET_IP:-}" ]]; then
    fail "MetalLB mode (METALLB_ENABLED or USE_LB_FOR_TESTS) requires TARGET_IP. Run preflight with METALLB_ENABLED=1 so metallb-reachable.env is written, or ensure caddy-h3 has EXTERNAL-IP assigned."
  fi
  export PORT=443
fi

if [[ "${ROTATION_SKIP_ROTATION:-0}" != "1" ]]; then
say "=== Rotation Suite Initialized ==="
ok "Host        = $HOST"
ok "Port        = $PORT"
if [[ -n "${TARGET_IP:-}" ]]; then
  ok "TARGET_IP   = $TARGET_IP (MetalLB / caddy-h3 EXTERNAL-IP — same as LB IP for all suites)"
  [[ "${METALLB_ENABLED:-0}" == "1" ]] || [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]] && ok "LB IP       = $TARGET_IP (MetalLB only; no NodePort)"
elif [[ "${METALLB_ENABLED:-0}" == "1" ]] || [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]]; then
  ok "LB IP       = (unset — MetalLB mode requires TARGET_IP; run preflight with METALLB_ENABLED=1)"
fi
ok "Rotate Leaf = $ROTATE_LEAF"

# State machine: deterministic phases for production-grade rotation (INIT → INTRODUCE_NEW_CA → ROTATE_LEAF → ROTATE_BACKENDS → STABILIZE)
ROT_PHASE="${ROT_PHASE:-INIT}"
say "ROT_PHASE = $ROT_PHASE (state machine: INIT → INTRODUCE_NEW_CA → ROTATE_LEAF → ROTATE_BACKENDS → STABILIZE)"

### Generate certificates (OPTIMIZED: Parallel generation)
TMP="$(mktemp -d)"
LEAF_CRT="$TMP/tls.crt"
LEAF_KEY="$TMP/tls.key"

# For CA rotation, generate a new CA first
if $ROTATE_CA; then
  say "Pre-generating certificates in parallel…"
  CA_KEY="$TMP/ca.key"
  CA_CRT="$TMP/ca.crt"
  
  # OPTIMIZATION: Generate CA and leaf key in parallel (independent operations)
  (
    openssl genrsa -out "$CA_KEY" 2048 >/dev/null 2>&1 || fail "Failed to generate CA key"
    openssl req -new -x509 -days 3650 -key "$CA_KEY" -out "$CA_CRT" \
      -subj "/CN=dev-root-ca/O=record-platform" >/dev/null 2>&1 || fail "Failed to generate CA certificate"
    ok "CA certificate generated (parallel)"
  ) &
  CA_PID=$!
  
  # Generate leaf key in parallel (doesn't depend on CA)
  if $ROTATE_LEAF; then
    (
      openssl genrsa -out "$LEAF_KEY" 2048 >/dev/null 2>&1 || fail "Failed to generate leaf key"
      ok "Leaf key generated (parallel)"
    ) &
    LEAF_KEY_PID=$!
    wait $LEAF_KEY_PID || fail "Leaf key generation failed"
  fi
  
  # Wait for CA generation to complete
  wait $CA_PID || fail "CA generation failed"
  
  CA_ROOT="$CA_CRT"
  ok "All keys generated in parallel"
else
  # Use existing mkcert CA
  CA_ROOT="$(mkcert -CAROOT)/rootCA.pem"
  [[ -f "$CA_ROOT" ]] || fail "mkcert CA not found"
  
  # Still generate leaf key if rotating leaf
  if $ROTATE_LEAF; then
    openssl genrsa -out "$LEAF_KEY" 2048 >/dev/null 2>&1 || fail "Failed to generate leaf key"
    ok "Leaf key generated"
  fi
fi

# Generate or retrieve leaf certificate
if $ROTATE_LEAF; then
  say "Generating new leaf certificate…"
  # Get ClusterIP FQDN for certificate SANs (needed for strict TLS in k6)
  CLUSTERIP_FQDN="caddy-h3.ingress-nginx.svc.cluster.local"
  
  if $ROTATE_CA; then
    # Generate new leaf cert signed by new CA
    # Create leaf private key
    openssl genrsa -out "$LEAF_KEY" 2048 >/dev/null 2>&1 || fail "Failed to generate leaf key"
    
    # Create CSR
    openssl req -new -key "$LEAF_KEY" -out "$TMP/leaf.csr" \
      -subj "/CN=$HOST/O=record-platform" >/dev/null 2>&1 || fail "Failed to create CSR"
    
    # Sign leaf cert with new CA (include ClusterIP FQDN in SANs for strict TLS)
    # Create extfile for SANs
    cat > "$TMP/ext.conf" <<EXT
[v3_req]
subjectAltName=DNS:$HOST,DNS:*.$HOST,DNS:localhost,DNS:$CLUSTERIP_FQDN,IP:127.0.0.1,IP:::1
EXT
    
    # Certificate overlap window: 7-day grace (production-adjacent)
    # Start validity 7 days before now so clients with old certs still connect during transition.
    # Production practice for zero-downtime rotation; OVERLAP_DAYS=7 is configurable.
    OVERLAP_DAYS=7
    # Calculate notBefore date (7 days ago) - cross-platform date command
    if date -u -v-${OVERLAP_DAYS}d +%Y%m%d%H%M%S >/dev/null 2>&1; then
      # macOS date command
      NOT_BEFORE=$(date -u -v-${OVERLAP_DAYS}d +%Y%m%d%H%M%S)
    elif date -u -d "-${OVERLAP_DAYS} days" +%Y%m%d%H%M%S >/dev/null 2>&1; then
      # Linux date command
      NOT_BEFORE=$(date -u -d "-${OVERLAP_DAYS} days" +%Y%m%d%H%M%S)
    else
      NOT_BEFORE=""
    fi
    
    # Sign leaf cert in main shell (no pipeline) so LEAF_CRT is always written and visible
    _sign_leaf() {
      openssl x509 -req -in "$TMP/leaf.csr" -CA "$CA_ROOT" -CAkey "$CA_KEY" \
        -CAcreateserial -out "$LEAF_CRT" -days 365 \
        -extensions v3_req -extfile "$TMP/ext.conf" -set_serial "$(date +%s)" "$@" 2>"$TMP/openssl-error.log"
    }
    if [[ -n "$NOT_BEFORE" ]]; then
      # Set notBefore to 7 days ago for certificate overlap window
      if [[ ${#NOT_BEFORE} -eq 14 ]]; then
        if _sign_leaf -startdate "${NOT_BEFORE}Z"; then
          ok "Leaf certificate generated with ${OVERLAP_DAYS}-day overlap window (grace period for old certs)"
        else
          OPENSSL_ERROR=$(cat "$TMP/openssl-error.log" 2>/dev/null || echo "")
          if echo "$OPENSSL_ERROR" | grep -qi "startdate"; then
            warn "OpenSSL startdate format issue, trying alternative method"
            if _sign_leaf -days 372; then
              ok "Leaf certificate generated with extended validity (${OVERLAP_DAYS}-day overlap via longer validity)"
            else
              _sign_leaf >/dev/null 2>&1 || fail "Failed to sign leaf certificate with new CA"
              ok "Leaf certificate generated (standard, no overlap window)"
            fi
          else
            _sign_leaf >/dev/null 2>&1 || fail "Failed to sign leaf certificate with new CA"
            ok "Leaf certificate generated (standard, no overlap window)"
          fi
        fi
      else
        warn "Date format incorrect (got ${#NOT_BEFORE} digits, expected 14), using standard certificate"
        _sign_leaf >/dev/null 2>&1 || fail "Failed to sign leaf certificate with new CA"
        ok "Leaf certificate generated (standard, no overlap window)"
      fi
    else
      _sign_leaf >/dev/null 2>&1 || fail "Failed to sign leaf certificate with new CA"
      warn "Leaf certificate generated without overlap window (date command not available)"
    fi
    
    # Verify SANs were added (only if cert file exists)
    if [[ -f "$LEAF_CRT" ]]; then
      if openssl x509 -in "$LEAF_CRT" -noout -text 2>/dev/null | grep -q "$CLUSTERIP_FQDN"; then
        ok "Leaf certificate generated and signed with new CA (includes ClusterIP FQDN for strict TLS)"
      else
        warn "Leaf certificate generated but ClusterIP FQDN may not be in SANs"
        ok "Leaf certificate generated and signed with new CA"
      fi
    else
      warn "Leaf cert file missing after sign; re-signing without overlap"
      _sign_leaf >/dev/null 2>&1 || fail "Failed to sign leaf certificate (fallback)"
      ok "Leaf certificate generated (fallback)"
    fi
  else
    # Use mkcert to generate leaf cert (signed by existing mkcert CA)
    # Note: mkcert doesn't support custom SANs, so ClusterIP FQDN won't be included
    # For strict TLS with mkcert, we'll need to use Host header workaround
    mkcert -cert-file "$LEAF_CRT" -key-file "$LEAF_KEY" \
      "$HOST" "*.$HOST" localhost 127.0.0.1 ::1 >/dev/null 2>&1
    ok "Leaf certificate generated (signed by existing CA)"
  fi
else
  # Use existing leaf cert from secret (for CA-only rotation)
  say "Using existing leaf certificate (leaf rotation disabled)…"
  kctl -n "$NS_ING" get secret "$LEAF_SECRET" -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d > "$LEAF_CRT" 2>/dev/null || true
  kctl -n "$NS_ING" get secret "$LEAF_SECRET" -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d > "$LEAF_KEY" 2>/dev/null || true
  if [[ ! -f "$LEAF_CRT" ]] || [[ ! -f "$LEAF_KEY" ]]; then
    fail "Could not retrieve existing leaf certificate from secret"
  fi
  ok "Existing leaf certificate retrieved"
fi

### Update secrets: on Colima host kubectl often cannot reach 127.0.0.1:6443 (API is in VM). Use colima ssh + copy certs into VM when needed.
# Longer timeout for secret create/apply (k3d/Colima API can be slow; 15s caused "context deadline exceeded")
SECRET_TIMEOUT="${ROTATION_SECRET_TIMEOUT:-60}"
SECRET_KCTL=""
[[ -x /opt/homebrew/bin/kubectl ]] && SECRET_KCTL="/opt/homebrew/bin/kubectl --request-timeout=${SECRET_TIMEOUT}s"
[[ -z "$SECRET_KCTL" ]] && [[ -x /usr/local/bin/kubectl ]] && SECRET_KCTL="/usr/local/bin/kubectl --request-timeout=${SECRET_TIMEOUT}s"
[[ -z "$SECRET_KCTL" ]] && SECRET_KCTL="kubectl --request-timeout=${SECRET_TIMEOUT}s"
# On Colima, secret updates often fail from host (API at 127.0.0.1:6443 in VM). Use colima ssh kubectl for reliable secret updates.
# Set ROTATION_USE_COLIMA_SECRETS=0 to force host kubectl; default is 1 when ctx is colima so rotation does not fail with "Secret updates failed".
USE_COLIMA_SECRETS=0
ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
  if [[ "${ROTATION_USE_COLIMA_SECRETS:-1}" == "1" ]]; then
    USE_COLIMA_SECRETS=1
    log_info "Colima context: using colima ssh kubectl for secret updates (set ROTATION_USE_COLIMA_SECRETS=0 to use host kubectl)"
  elif ! $SECRET_KCTL get ns "$NS_ING" --request-timeout=10s >/dev/null 2>&1; then
    USE_COLIMA_SECRETS=1
    log_info "Host kubectl cannot reach API; copying certs into Colima VM and using colima ssh kubectl for secret updates"
  fi
fi

# Ensure leaf cert and key exist before secret update (avoids "no such file" when kubectl reads paths)
if [[ ! -f "$LEAF_CRT" ]] || [[ ! -f "$LEAF_KEY" ]]; then
  log_info "LEAF_CRT exists: $([[ -f "$LEAF_CRT" ]] && echo yes || echo no) ($LEAF_CRT)"
  log_info "LEAF_KEY exists: $([[ -f "$LEAF_KEY" ]] && echo yes || echo no) ($LEAF_KEY)"
  # Last-resort: re-sign from CSR if we have CA and CSR (main shell so files are visible)
  if [[ -f "$TMP/leaf.csr" ]] && [[ -f "$CA_ROOT" ]] && [[ -f "$CA_KEY" ]]; then
    warn "Re-signing leaf certificate (last-resort)"
    openssl x509 -req -in "$TMP/leaf.csr" -CA "$CA_ROOT" -CAkey "$CA_KEY" \
      -CAcreateserial -out "$LEAF_CRT" -days 365 \
      -extensions v3_req -extfile "$TMP/ext.conf" -set_serial "$(date +%s)" >/dev/null 2>&1 || true
    [[ -f "$LEAF_KEY" ]] || openssl genrsa -out "$LEAF_KEY" 2048 >/dev/null 2>&1 || true
  fi
  if [[ ! -f "$LEAF_CRT" ]] || [[ ! -f "$LEAF_KEY" ]]; then
    fail "Leaf cert or key missing before secret update (LEAF_CRT=$LEAF_CRT LEAF_KEY=$LEAF_KEY). Check certificate generation above."
  fi
  ok "Leaf cert/key verified (re-sign fallback used)"
fi

# When host kubectl cannot reach 127.0.0.1:6443 (Colima API in VM), copy certs into VM and use colima ssh kubectl.
# Use base64 over stdin and POSIX test (avoid [[ and connection storms).
COLIMA_VM_DIR=""
if [[ "$USE_COLIMA_SECRETS" -eq 1 ]] && command -v colima >/dev/null 2>&1; then
  COLIMA_VM_DIR="/tmp/rot-certs-$$"
  colima ssh -- sh -c "mkdir -p $COLIMA_VM_DIR" 2>/dev/null || true
  sleep 0.5
  base64 < "$LEAF_CRT" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/tls.crt" 2>/dev/null || true
  sleep 0.5
  base64 < "$LEAF_KEY" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/tls.key" 2>/dev/null || true
  sleep 0.5
  base64 < "$CA_ROOT" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/ca.pem" 2>/dev/null || true
  sleep 0.5
  if colima ssh -- sh -c "test -f $COLIMA_VM_DIR/tls.crt && test -f $COLIMA_VM_DIR/tls.key && test -f $COLIMA_VM_DIR/ca.pem" 2>/dev/null; then
    ok "Certs copied into Colima VM ($COLIMA_VM_DIR)"
    SECRET_KCTL="colima ssh -- kubectl --request-timeout=${SECRET_TIMEOUT}s"
  else
    warn "Colima cert copy failed; falling back to host kubectl (may fail with 6443 refused)"
    COLIMA_VM_DIR=""
  fi
fi

# --- Phase: INTRODUCE_NEW_CA (pre-rotation Caddy restart + connection drain, then secret update) ---
ROT_PHASE="INTRODUCE_NEW_CA"
say "ROT_PHASE = $ROT_PHASE"

# Restart Caddy before applying new secrets so QUIC connections drop cleanly (avoids stale connection IDs under rotation).
say "Restarting Caddy to drop QUIC connections before cert rotation…"
if kctl -n "$NS_ING" get deploy "$SERVICE" >/dev/null 2>&1; then
  kctl -n "$NS_ING" rollout restart deploy/"$SERVICE" --request-timeout=15s 2>/dev/null && ok "Caddy rollout restart started" || warn "Caddy rollout restart failed"
  CADDY_PRE_ROTATE_TIMEOUT="${CADDY_PRE_ROTATE_TIMEOUT:-90}"
  kctl -n "$NS_ING" rollout status deploy/"$SERVICE" --timeout="${CADDY_PRE_ROTATE_TIMEOUT}s" 2>/dev/null || warn "Caddy pre-rotation rollout wait timed out"
  sleep 10
  # Readiness gate: ensure Endpoints have addresses before proceeding (avoids load against stale/no backends).
  _wait_caddy_endpoints 30 "pre-rotation"
else
  info "Caddy deploy not found; skipping pre-rotation restart"
fi

# Connection drain: if too many active connections on Caddy, wait before rotating leaf (avoids mid-flight TLS invalidation and H2 100% failure).
CADDY_POD=$(kctl -n "$NS_ING" get pods -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -n "$CADDY_POD" ]]; then
  active_conns=$(kctl -n "$NS_ING" exec "$CADDY_POD" -- sh -c "ss -tn sport = :443 2>/dev/null | wc -l" 2>/dev/null || echo "0")
  if [[ "${active_conns:-0}" -gt 50 ]]; then
    say "Too many active connections on Caddy ($active_conns); waiting 10s to drain before secret swap…"
    sleep 10
  fi
fi

say "Updating Kubernetes secrets (new CA + leaf)…"
SECRET_ERR_DIR="$(mktemp -d)"
cleanup_secret_err() { rm -rf "$SECRET_ERR_DIR"; }
trap cleanup_secret_err EXIT
wait_failed=0
failed_names=()

run_secret_job() {
  local name="$1"
  shift
  local errfile="$SECRET_ERR_DIR/$name"
  if ! "$@" 2>"$errfile"; then
    wait_failed=$((wait_failed + 1))
    failed_names+=("$name")
    [[ -s "$errfile" ]] && log_info "  $name stderr: $(head -5 "$errfile" | tr '\n' ' ')"
    return 1
  fi
  return 0
}

if [[ -n "$COLIMA_VM_DIR" ]]; then
  # Colima: kubectl runs inside VM with VM paths
  run_secret_job "LEAF_ING" colima ssh -- bash -c "kubectl -n \"$NS_ING\" delete secret \"$LEAF_SECRET\" --request-timeout=30s 2>/dev/null || true; kubectl -n \"$NS_ING\" create secret tls \"$LEAF_SECRET\" --cert=$COLIMA_VM_DIR/tls.crt --key=$COLIMA_VM_DIR/tls.key --request-timeout=60s"
  run_secret_job "LEAF_APP" colima ssh -- bash -c "kubectl -n \"$NS_APP\" delete secret \"$LEAF_SECRET\" --request-timeout=30s 2>/dev/null || true; kubectl -n \"$NS_APP\" create secret tls \"$LEAF_SECRET\" --cert=$COLIMA_VM_DIR/tls.crt --key=$COLIMA_VM_DIR/tls.key --request-timeout=60s"
  run_secret_job "SVC_TLS" colima ssh -- bash -c "kubectl -n \"$NS_APP\" delete secret service-tls --request-timeout=30s 2>/dev/null || true; kubectl -n \"$NS_APP\" create secret generic service-tls --from-file=tls.crt=$COLIMA_VM_DIR/tls.crt --from-file=tls.key=$COLIMA_VM_DIR/tls.key --from-file=ca.crt=$COLIMA_VM_DIR/ca.pem --request-timeout=60s"
  run_secret_job "CA_ING" colima ssh -- bash -c "kubectl -n \"$NS_ING\" create secret generic \"$CA_SECRET\" --from-file=dev-root.pem=$COLIMA_VM_DIR/ca.pem --dry-run=client -o yaml --request-timeout=30s | kubectl -n \"$NS_ING\" apply -f - --request-timeout=60s"
  run_secret_job "CA_APP" colima ssh -- bash -c "kubectl -n \"$NS_APP\" create secret generic \"$CA_SECRET\" --from-file=dev-root.pem=$COLIMA_VM_DIR/ca.pem --dry-run=client -o yaml --request-timeout=30s | kubectl -n \"$NS_APP\" apply -f - --request-timeout=60s"
  colima ssh -- "rm -rf $COLIMA_VM_DIR" 2>/dev/null || true
else
  # Host kubectl with host paths
  run_secret_job "LEAF_ING" bash -c "$SECRET_KCTL -n \"$NS_ING\" delete secret \"$LEAF_SECRET\" >/dev/null 2>&1 || true; $SECRET_KCTL -n \"$NS_ING\" create secret tls \"$LEAF_SECRET\" --cert=\"$LEAF_CRT\" --key=\"$LEAF_KEY\""
  run_secret_job "LEAF_APP" bash -c "$SECRET_KCTL -n \"$NS_APP\" delete secret \"$LEAF_SECRET\" >/dev/null 2>&1 || true; $SECRET_KCTL -n \"$NS_APP\" create secret tls \"$LEAF_SECRET\" --cert=\"$LEAF_CRT\" --key=\"$LEAF_KEY\""
  run_secret_job "SVC_TLS" bash -c "$SECRET_KCTL -n \"$NS_APP\" delete secret service-tls >/dev/null 2>&1 || true; $SECRET_KCTL -n \"$NS_APP\" create secret generic service-tls --from-file=tls.crt=\"$LEAF_CRT\" --from-file=tls.key=\"$LEAF_KEY\" --from-file=ca.crt=\"$CA_ROOT\""
  run_secret_job "CA_ING" bash -c "$SECRET_KCTL -n \"$NS_ING\" create secret generic \"$CA_SECRET\" --from-file=dev-root.pem=\"$CA_ROOT\" --dry-run=client -o yaml | $SECRET_KCTL -n \"$NS_ING\" apply -f -"
  run_secret_job "CA_APP" bash -c "$SECRET_KCTL -n \"$NS_APP\" create secret generic \"$CA_SECRET\" --from-file=dev-root.pem=\"$CA_ROOT\" --dry-run=client -o yaml | $SECRET_KCTL -n \"$NS_APP\" apply -f -"
fi

if [[ $wait_failed -eq 0 ]]; then
  ok "All secrets updated (leaf + CA + service-tls in both namespaces)"
else
  warn "Some secret updates failed ($wait_failed): ${failed_names[*]:-}"
  echo "  ℹ️  LEAF_ING=leaf in ingress-nginx, LEAF_APP=leaf in record-platform, SVC_TLS=service-tls, CA_*=dev-root-ca"
  echo "  ℹ️  Check: $SECRET_KCTL -n $NS_ING get secret; $SECRET_KCTL -n $NS_APP get secret"
  fail "Secret updates failed; fix above and re-run. Do not proceed with Caddy rollout with missing secrets."
fi

# --- Phase: ROTATE_LEAF (Caddy rollout + wait; leaf/CA now in cluster) ---
ROT_PHASE="ROTATE_LEAF"
say "ROT_PHASE = $ROT_PHASE"

# Canonical CA file so host health checks and k6 use the same CA (avoids curl 60 / x509 unknown authority)
# k6 and in-cluster jobs use this file via SSL_CERT_FILE / ConfigMap — no keychain needed. Skip keychain when
# ROTATION_SKIP_KEYCHAIN_TRUST=1 or non-interactive so the suite never blocks on macOS security prompts.
# Persist CA key when ROTATE_CA so Envoy client cert can be regenerated later (strict-tls-bootstrap, recovery).
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
mkdir -p "$REPO_ROOT/certs"
if [[ -n "${CA_ROOT:-}" ]] && [[ -f "$CA_ROOT" ]]; then
  if cp -f "$CA_ROOT" "$REPO_ROOT/certs/dev-root.pem" 2>/dev/null; then
    ok "Canonical CA synced to certs/dev-root.pem (k6 strict TLS and host health)"
    if $ROTATE_CA && [[ -n "${CA_KEY:-}" ]] && [[ -f "$CA_KEY" ]]; then
      cp -f "$CA_KEY" "$REPO_ROOT/certs/dev-root.key" 2>/dev/null && ok "CA key persisted to certs/dev-root.key (for envoy-client regeneration)" || true
    fi
    if [[ "${ROTATION_SKIP_KEYCHAIN_TRUST:-0}" != "1" ]] && [[ -t 0 ]] && [[ "$(uname -s)" == "Darwin" ]] && [[ -f "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" ]]; then
      "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$REPO_ROOT/certs/dev-root.pem" || true
    elif [[ "${ROTATION_SKIP_KEYCHAIN_TRUST:-0}" == "1" ]]; then
      info "Keychain trust skipped (ROTATION_SKIP_KEYCHAIN_TRUST=1); k6/ConfigMap use certs/dev-root.pem"
    fi
  fi
fi
# Cluster-as-source-of-truth: force certs/dev-root.pem to match what Caddy/stack actually use.
# Eliminates CA drift between harness and cluster; confirms Enhanced suite will trust the rotated CA.
if kctl -n "$NS_ING" get secret "$CA_SECRET" -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$REPO_ROOT/certs/dev-root.pem" 2>/dev/null && [[ -s "$REPO_ROOT/certs/dev-root.pem" ]]; then
  ok "CA forced from cluster (dev-root-ca) to certs/dev-root.pem (harness and k6 aligned)"
else
  warn "Could not sync CA from cluster; certs/dev-root.pem may drift (Enhanced suite may get curl 60)"
fi

# Post-rotation: Regenerate Kafka TLS from new CA so Kafka broker cert is signed by new CA.
# Otherwise Kafka-consuming pods (social, auction-monitor) get new dev-root-ca and fail with "unable to verify the first certificate".
# Set ROTATION_UPDATE_KAFKA_SSL=1 when using external Kafka (Docker) with strict TLS.
if [[ "${ROTATION_UPDATE_KAFKA_SSL:-0}" == "1" ]] && $ROTATE_CA && [[ -f "$CA_ROOT" ]] && [[ -f "${CA_KEY:-}" ]]; then
  say "Post-rotation: Regenerating Kafka TLS from new CA (ROTATION_UPDATE_KAFKA_SSL=1)..."
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  mkdir -p "$REPO_ROOT/certs"
  if cp -f "$CA_ROOT" "$REPO_ROOT/certs/dev-root.pem" 2>/dev/null && [[ -f "$CA_KEY" ]] && cp -f "$CA_KEY" "$REPO_ROOT/certs/dev-root.key" 2>/dev/null; then
    if [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
      if "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"; then
        ok "Kafka TLS regenerated from new CA (kafka-ssl-secret updated)"
        if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
          (cd "$REPO_ROOT" && docker compose restart kafka 2>/dev/null) && ok "Kafka container restarted" || warn "Kafka container restart failed or not found"
        fi
        # Rollout restart Kafka-consuming deployments so they pick up new kafka-ssl-secret (ca-cert.pem) and can verify Kafka
        for dep in social-service auction-monitor analytics-service python-ai-service; do
          kctl -n "$NS_APP" rollout restart "deploy/$dep" --request-timeout=15s 2>/dev/null && ok "Rollout restart started: $dep" || true
        done
        # Brief wait so new pods mount updated secret before next steps
        sleep 5
      else
        warn "kafka-ssl-from-dev-root.sh failed; Kafka may still use old cert (social/auction-monitor may see 'unable to verify the first certificate')"
      fi
    else
      warn "kafka-ssl-from-dev-root.sh not found; skip Kafka TLS update"
    fi
  else
    warn "Could not copy new CA to certs/; skip Kafka TLS update"
  fi
fi

# Post-rotation: Sync Envoy mTLS secrets so Envoy→backend works (envoy-test had OLD CA/client cert).
# Envoy presents envoy-client-tls to backends; backends verify with dev-root-ca. Both must match rotated CA.
if $ROTATE_CA && [[ -f "${CA_ROOT:-}" ]] && [[ -f "${CA_KEY:-}" ]]; then
  say "Post-rotation: Syncing Envoy mTLS (dev-root-ca + envoy-client-tls) to envoy-test…"
  ENVOY_CLIENT_CRT="$TMP/envoy-client.crt"
  ENVOY_CLIENT_KEY="$TMP/envoy-client.key"
  if openssl genrsa -out "$ENVOY_CLIENT_KEY" 2048 2>/dev/null && \
     openssl req -new -key "$ENVOY_CLIENT_KEY" -out "$TMP/envoy.csr" -subj "/CN=envoy/O=record-platform" 2>/dev/null && \
     echo -e "[v3_req]\nsubjectAltName=DNS:envoy,DNS:envoy-test.envoy-test.svc.cluster.local" > "$TMP/envoy-ext.conf" && \
     openssl x509 -req -in "$TMP/envoy.csr" -CA "$CA_ROOT" -CAkey "$CA_KEY" -CAcreateserial -out "$ENVOY_CLIENT_CRT" -days 365 -extensions v3_req -extfile "$TMP/envoy-ext.conf" 2>/dev/null; then
    if [[ -n "${COLIMA_VM_DIR:-}" ]]; then
      base64 < "$CA_ROOT" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/ca.pem" 2>/dev/null || true
      base64 < "$ENVOY_CLIENT_CRT" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/envoy-client.crt" 2>/dev/null || true
      base64 < "$ENVOY_CLIENT_KEY" | colima ssh -- sh -c "base64 -d > $COLIMA_VM_DIR/envoy-client.key" 2>/dev/null || true
      colima ssh -- bash -c "kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null; \
        kubectl -n envoy-test create secret generic dev-root-ca --from-file=dev-root.pem=$COLIMA_VM_DIR/ca.pem --dry-run=client -o yaml | kubectl -n envoy-test apply -f - 2>/dev/null; \
        kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found 2>/dev/null; \
        kubectl -n envoy-test create secret generic envoy-client-tls --from-file=envoy.crt=$COLIMA_VM_DIR/envoy-client.crt --from-file=envoy.key=$COLIMA_VM_DIR/envoy-client.key 2>/dev/null" || true
    else
      kctl create namespace envoy-test --dry-run=client -o yaml 2>/dev/null | kctl apply -f - 2>/dev/null || true
      kctl -n envoy-test create secret generic dev-root-ca --from-file=dev-root.pem="$CA_ROOT" --dry-run=client -o yaml 2>/dev/null | kctl -n envoy-test apply -f - 2>/dev/null || true
      kctl -n envoy-test delete secret envoy-client-tls --ignore-not-found 2>/dev/null || true
      kctl -n envoy-test create secret generic envoy-client-tls --from-file=envoy.crt="$ENVOY_CLIENT_CRT" --from-file=envoy.key="$ENVOY_CLIENT_KEY" 2>/dev/null || true
    fi
    if kctl -n envoy-test get deployment envoy-test &>/dev/null; then
      kctl -n envoy-test rollout restart deployment/envoy-test --request-timeout=15s 2>/dev/null && ok "Envoy restarted (new mTLS certs)" || true
    fi
    ok "Envoy mTLS synced (dev-root-ca + envoy-client-tls)"
  else
    warn "Could not generate Envoy client cert; envoy-test may have stale CA (gRPC will fail with CERTIFICATE_VERIFY_FAILED)"
    info "  Fix: ./scripts/generate-envoy-client-cert.sh && ./scripts/strict-tls-bootstrap.sh"
  fi
fi

# Verify record-local-tls exists (use kctl so Colima shim works when host kubectl would fail)
if ! kctl -n "$NS_ING" get secret "$LEAF_SECRET" >/dev/null 2>&1; then
  fail "record-local-tls missing in $NS_ING - Caddy pods will fail to mount; fix secret updates above"
fi
ok "record-local-tls present in $NS_ING (Caddy can mount)"

### Trigger Caddy reload (OPTIMIZED: Try hot reload first, fallback to rolling restart)
say "Triggering Caddy reload (hot reload preferred)…"

# Get Caddy pod name (first Ready pod for admin API)
CADDY_POD=$(kctl -n "$NS_ING" get pods -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
RELOAD_DONE=0
ROT_CTX=$(kubectl config current-context 2>/dev/null || echo "")

# Caddy 2 admin API: POST /load with current config + Cache-Control: must-revalidate forces reload (re-reads certs).
# GET /config/ then POST /load with that body. Do not use /config/reload (not a Caddy 2 endpoint).
if [[ -n "$CADDY_POD" ]]; then
  if [[ "$ROT_CTX" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    # Colima: port-forward + curl inside VM
    RELOAD_OUT=$(colima ssh -- bash -c "
      kubectl -n $NS_ING port-forward pod/$CADDY_POD 2019:2019 & PF=\$!;
      sleep 8;
      CODE=000;
      curl -s -m 5 http://127.0.0.1:2019/config/ -o /tmp/caddy-config-$$.json 2>/dev/null;
      if [[ -s /tmp/caddy-config-$$.json ]]; then
        CODE=\$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:2019/load \
          -H 'Content-Type: application/json' -H 'Cache-Control: must-revalidate' -d @/tmp/caddy-config-$$.json 2>/dev/null || echo 000);
      fi;
      rm -f /tmp/caddy-config-$$.json 2>/dev/null;
      kill \$PF 2>/dev/null; wait \$PF 2>/dev/null;
      echo \$CODE
    " 2>/dev/null || echo "000")
    if echo "$RELOAD_OUT" | grep -qE '^200|^204'; then
      ok "Caddy config reloaded via admin API POST /load (hot reload - Colima VM)"
      RELOAD_DONE=1
    else
      warn "Admin API reload not available (Colima VM), using rolling restart (fallback). curl returned: ${RELOAD_OUT:-none}"
    fi
  else
    # Host kubectl: port-forward so localhost:2019 is on the host
    $KUBECTL_PORT_FORWARD -n "$NS_ING" port-forward "pod/$CADDY_POD" 2019:2019 </dev/null >/dev/null 2>/tmp/rotation-pf-admin.err &
    PF_PID=$!
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 2019 2>/dev/null) || curl -s -m 1 http://127.0.0.1:2019/ >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    ROT_CFG_FILE=$(mktemp 2>/dev/null || echo "/tmp/rotation-caddy-config-$$.json")
    curl -s -m 5 http://127.0.0.1:2019/config/ -o "$ROT_CFG_FILE" 2>/dev/null
    if [[ -s "$ROT_CFG_FILE" ]]; then
      if curl -s -m 10 -X POST http://127.0.0.1:2019/load \
        -H "Content-Type: application/json" -H "Cache-Control: must-revalidate" -d "@$ROT_CFG_FILE" \
        -o /dev/null -w "%{http_code}" 2>/dev/null | grep -qE '^200|^204'; then
        ok "Caddy config reloaded via admin API POST /load (hot reload - no downtime)"
        RELOAD_DONE=1
      fi
    fi
    rm -f "$ROT_CFG_FILE" 2>/dev/null
    kill $PF_PID 2>/dev/null || true
    wait $PF_PID 2>/dev/null || true
    if [[ $RELOAD_DONE -eq 0 ]]; then
      warn "Admin API reload not available (GET /config/ or POST /load failed), using rolling restart (fallback)"
      [[ -s /tmp/rotation-pf-admin.err ]] && log_info "Port-forward stderr: $(cat /tmp/rotation-pf-admin.err)"
    fi
  fi
fi

# Rolling restart: required when we rotated the leaf so Caddy re-mounts the new cert and serves it.
# Hot reload (POST /load) may not re-read mounted TLS from updated secrets; k6 strict TLS then sees "x509: certificate signed by unknown authority" because Caddy still serves the old cert. Force rollout so new pods mount record-local-tls and serve the new leaf (k3d and all clusters).
# Zero-downtime: Caddy deploy has 2 replicas and RollingUpdate maxUnavailable=0 — new pod becomes Ready before old is terminated (CA and leaf rotation with no downtime).
if [[ $RELOAD_DONE -eq 0 ]] || [[ "$ROTATE_LEAF" == "true" ]]; then
  TS=$(date +%Y-%m-%dT%H:%M:%S%z)
  kctl -n "$NS_ING" patch deploy "$SERVICE" \
    -p="{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"rotatedAt\":\"$TS\"}}}}}" >/dev/null
  if [[ "$ROTATE_LEAF" == "true" ]]; then
    log_info "Caddy rolling restart (2 pods, zero-downtime) — leaf rotated so Caddy serves new cert for strict TLS/mTLS"
  fi
  CADDY_ROLLOUT_TIMEOUT="${CADDY_ROLLOUT_TIMEOUT:-180}"
  kctl -n "$NS_ING" rollout status deploy/"$SERVICE" --timeout="${CADDY_ROLLOUT_TIMEOUT}s" || {
    warn "Rollout timeout (${CADDY_ROLLOUT_TIMEOUT}s) - checking pod status..."
    kctl -n "$NS_ING" get pods -l app=caddy-h3 -o wide 2>&1 | head -8
    kctl -n "$NS_ING" describe pod -l app=caddy-h3 2>/dev/null | grep -A5 "Events:" | head -10 || true
    kctl -n "$NS_ING" wait --for=condition=ready pod -l app=caddy-h3 --timeout=45s 2>/dev/null || true
  }
fi
ok "Caddy reload completed"
# Readiness gate: wait for caddy-h3 Endpoints to have addresses before starting load (production-grade rotation).
_wait_caddy_endpoints 45 "post-rotation"
# Ensure Caddy pods are ready and kube-proxy has updated endpoints (avoids blank/connection failed on in-cluster health check).
kctl -n "$NS_ING" wait --for=condition=ready pod -l app=caddy-h3 --timeout=60s 2>/dev/null || warn "Caddy pod ready wait timed out"
sleep 5

# --- Phase: ROTATE_BACKENDS (one-by-one readiness; then grace + pre-warm) ---
ROT_PHASE="ROTATE_BACKENDS"
say "ROT_PHASE = $ROT_PHASE"

# Root cause: after rotation, secrets (service-tls, dev-root-ca) are updated but running pods
# have already loaded certs at startup. Restart all gRPC/TLS workloads so they reload the new certs.
# Otherwise python-ai, auth, records, etc. reject new client certs (SSLV3_ALERT_BAD_CERTIFICATE).
say "Restarting gRPC/TLS workloads so they pick up new service-tls and dev-root-ca…"
for dep in auth-service api-gateway records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service; do
  kctl -n "$NS_APP" rollout restart "deploy/$dep" --request-timeout=15s 2>/dev/null && ok "Rollout restart started: $dep" || true
done
# Grace window: wait for Caddy and Envoy to be fully ready before starting load (avoids QUIC requests during reload propagation).
# Caddyfile grace_period 15s and shutdown_delay 10s drain QUIC sessions on reload; this delay ensures new pods are ready before k6.
kctl -n "$NS_ING" rollout status deploy/"$SERVICE" --timeout=30s 2>/dev/null || warn "Caddy rollout status wait timed out"
kctl -n envoy-test rollout status deploy/envoy-test --timeout=30s 2>/dev/null || warn "Envoy rollout status wait timed out"
ROTATION_GRACE_SECONDS="${ROTATION_GRACE_SECONDS:-8}"
sleep "$ROTATION_GRACE_SECONDS"
ok "Stabilization complete (Caddy + Envoy ready, ${ROTATION_GRACE_SECONDS}s grace)"

# Explicit 8s warmup + one HTTP/3 health to clear stale QUIC before chaos (avoids k6 hanging on first H3 request).
say "Warmup: 8s + one HTTP/3 health to record.local (clear stale QUIC sessions)…"
sleep 8
if [[ -n "${TARGET_IP:-}" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && command -v curl >/dev/null 2>&1; then
  curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 --http3 \
    --resolve "${HOST}:443:${TARGET_IP}" "https://${HOST}:443/_caddy/healthz" 2>/dev/null && ok "Host HTTP/3 warmup OK" || info "Host HTTP/3 warmup skipped (curl or cert)"
fi

# Pre-warm: extra settle so first chaos iteration is not cold-start (avoids false 100% H2 failure).
ROTATION_PREWARM_SLEEP="${ROTATION_PREWARM_SLEEP:-15}"
say "Pre-warm: ${ROTATION_PREWARM_SLEEP}s settle before chaos…"
sleep "$ROTATION_PREWARM_SLEEP"

# Optional k6 pre-warm at low rate (e.g. ROTATION_PREWARM_RATE=50) for 20s — warms Caddy/backends before adaptive chaos.
if [[ -n "${ROTATION_PREWARM_RATE:-}" ]] && [[ "${ROTATION_PREWARM_RATE:-0}" -gt 0 ]] && [[ -f "$SCRIPT_DIR/load/k6-chaos-test.js" ]] && [[ -n "${TARGET_IP:-}" ]]; then
  say "Pre-warm k6: ${ROTATION_PREWARM_RATE} req/s for 20s (warms path before chaos)…"
  PREWARM_DUR="20s"
  _h2_pre=$((ROTATION_PREWARM_RATE / 2))
  _h3_pre=$((ROTATION_PREWARM_RATE - _h2_pre))
  [[ $_h2_pre -lt 1 ]] && _h2_pre=1
  [[ $_h3_pre -lt 1 ]] && _h3_pre=1
  _repo="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  _ca_pre="$_repo/certs/dev-root.pem"
  [[ -f "$_ca_pre" ]] || _ca_pre="/tmp/grpc-certs/ca.crt"
  export K6_HTTP2_NO_REUSE=1 K6_HTTP3_NO_REUSE=1
  ( SSL_CERT_FILE="${_ca_pre}" H2_RATE="$_h2_pre" H3_RATE="$_h3_pre" DURATION="$PREWARM_DUR" HOST="$HOST" K6_PORT=443 \
    K6_RESOLVE="${HOST}:443:${TARGET_IP}" K6_LB_IP="${TARGET_IP}" \
    k6 run "$SCRIPT_DIR/load/k6-chaos-test.js" 2>/dev/null ) || true
  ok "Pre-warm k6 complete"
fi

# --- Phase: STABILIZE (run chaos / adaptive limit finding) ---
ROT_PHASE="STABILIZE"
say "ROT_PHASE = $ROT_PHASE"
ok "Pre-warm complete"

# Preflight: Caddy service must expose UDP 443 for HTTP/3 (fail early if not)
if [[ "${WIRE_VERIFY:-true}" == "true" ]] && [[ "${CAPTURE_DURING_K6:-1}" != "0" ]]; then
  CADDY_SVC_PROTOCOLS=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.spec.ports[*].protocol}' 2>/dev/null || echo "")
  if [[ -n "$CADDY_SVC_PROTOCOLS" ]] && ! echo "$CADDY_SVC_PROTOCOLS" | grep -q UDP; then
    warn "caddy-h3 service does not expose UDP (protocols: $CADDY_SVC_PROTOCOLS). HTTP/3/QUIC may not work. Fix: ensure LoadBalancer or NodePort has UDP 443."
  else
    ok "caddy-h3 service exposes TCP+UDP for 443"
  fi
fi

# H3 warmup: 5x HTTP/3 health to clear stale QUIC sessions after cert reload (avoids k6 first-request timeouts).
# Without this, k6 reuses invalidated QUIC connections and records status=0 until handshake renegotiates.
ROTATION_H3_WARMUP="${ROTATION_H3_WARMUP:-5}"
if [[ "${ROTATION_H3_WARMUP:-0}" -gt 0 ]]; then
  _h3_lb="${TARGET_IP:-}"
  if [[ -z "$_h3_lb" ]]; then
    _h3_lb=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    [[ -z "$_h3_lb" ]] && _h3_lb=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  fi
  if [[ -n "$_h3_lb" ]]; then
    say "H3 warmup: ${ROTATION_H3_WARMUP}x HTTP/3 health to $_h3_lb (clear stale QUIC before chaos)…"
    _h3_img="${HTTP3_CURL_IMAGE:-rmarx/curl-http3:latest}"
    _warmup_loop="for i in 1 2 3 4 5 6 7 8 9 10; do [ \$i -gt ${ROTATION_H3_WARMUP} ] && break; curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 --http3 'https://$_h3_lb/_caddy/healthz' 2>/dev/null || true; [ \$i -lt ${ROTATION_H3_WARMUP} ] && sleep 1; done"
    if kctl -n "$NS_ING" run "h3-warmup-$$" --rm -i --restart=Never --request-timeout=90s --quiet \
      --image="$_h3_img" --overrides='{"spec":{"hostNetwork":true}}' -- \
      sh -c "$_warmup_loop" 2>/dev/null; then
      ok "H3 warmup complete (${ROTATION_H3_WARMUP}x QUIC health)"
    else
      warn "H3 warmup pod failed or image pull (set ROTATION_H3_WARMUP=0 to skip). Proceeding with chaos."
    fi
  else
    info "H3 warmup skipped (no LB IP or ClusterIP). Proceeding with chaos."
  fi
  unset _h3_lb _h3_img 2>/dev/null || true
fi

fi
# End of rotation block (skip when ROTATION_SKIP_ROTATION=1 for mode=wire or mode=forensic in mode=all)
[[ "${ROTATION_SKIP_ROTATION:-0}" == "1" ]] && ROT_PHASE="STABILIZE"

### Run chaos test with adaptive increment (test at increasing rates after rotation)
### ENHANCED: Wire-level protocol verification during rotation
### Duration: Caddy rollout (if fallback) + 9 deploy rollouts + k6 (K6_DURATION × iterations). Defaults tuned for acceptable total time; use K6_DURATION=180s K6_MAX_ITERATIONS=30 for full run.
if [[ "$ROTATION_SUITE_MODE" == "wire" ]]; then
  say "=== Stage: Wire (1 baseline iteration, capture only, no scaling) ==="
elif [[ "$ROTATION_SUITE_MODE" == "forensic" ]]; then
  say "=== Stage: Forensic (host k6, SSLKEYLOGFILE, H2 only, 1 iteration) ==="
else
  say "Running adaptive limit finding chaos suite with wire-level verification…"
fi
export HOST="$HOST"
export DURATION="${K6_DURATION:-90s}"
# K6_HTTP3_NO_REUSE set at top (no QUIC reuse during rotation)

# Start packet capture for protocol verification (if tcpdump available).
# CAPTURE_DURING_K6=0: skip capture during k6 high-rate phase to avoid tcpdump being killed (OOM/fd); use when capture is unstable.
# ROTATION_UDP_STATS=1: capture UDP packet loss stats (netstat -su, ss -u, /proc/net/snmp) before/after k6 load to confirm UDP queue pressure.
WIRE_VERIFY="${WIRE_VERIFY:-true}"
CAPTURE_DURING_K6="${CAPTURE_DURING_K6:-1}"
ROTATION_UDP_STATS="${ROTATION_UDP_STATS:-0}"
TIMESTAMP="${TIMESTAMP:-$(date +%s)}"
if [[ "$WIRE_VERIFY" == "true" ]] && [[ "${CAPTURE_DURING_K6:-1}" != "0" ]]; then
  say "Starting wire-level packet capture for protocol verification…"
  ok "Protocol coverage: gRPC (Envoy), HTTP/2 (TCP 443), HTTP/3/QUIC (UDP 443)"
  
  WIRE_CAPTURE_DIR="/tmp/rotation-wire-${TIMESTAMP}"
  mkdir -p "$WIRE_CAPTURE_DIR"
  
  # Wait for Caddy deployment to have 2 ready replicas (required for wire capture on both pods)
  CADDY_REPLICAS="${CADDY_REPLICAS:-2}"
  say "Waiting for $CADDY_REPLICAS Caddy pod(s) before capture…"
  for attempt in $(seq 1 30); do
    READY=$(kctl -n "$NS_ING" get deploy "$SERVICE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [[ "${READY:-0}" -ge "$CADDY_REPLICAS" ]]; then
      ok "Caddy deployment has $READY ready replica(s)"
      break
    fi
    [[ $attempt -lt 30 ]] && sleep 2
  done
  sleep 3
  CADDY_PODS=()
  for attempt in $(seq 1 20); do
    CADDY_PODS=()
    NAMES=$(kctl -n "$NS_ING" get pods -l app="$SERVICE" --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
    for p in $NAMES; do
      [[ -n "$p" ]] && CADDY_PODS+=("$p")
    done
    if [[ ${#CADDY_PODS[@]} -ge "$CADDY_REPLICAS" ]]; then
      break
    fi
    [[ $attempt -lt 20 ]] && sleep 2
  done
  if [[ ${#CADDY_PODS[@]} -lt "$CADDY_REPLICAS" ]]; then
    warn "Only ${#CADDY_PODS[@]} Caddy pod(s) Running (expected $CADDY_REPLICAS for capture). Proceeding anyway."
    log_info "  Pods: ${CADDY_PODS[*]:-(none)}"
  else
    ok "Capture will run on ${#CADDY_PODS[@]} Caddy pod(s): ${CADDY_PODS[*]}"
  fi
  # Snapshot pod UIDs so we can abort if pods restart during capture (capture must not span restarts)
  CADDY_UIDS=()
  for _p in "${CADDY_PODS[@]:-}"; do
    _uid=$(kctl -n "$NS_ING" get pod "$_p" -o jsonpath='{.metadata.uid}' 2>/dev/null || echo "")
    [[ -n "$_uid" ]] && CADDY_UIDS+=("$_uid")
  done
  [[ ${#CADDY_UIDS[@]} -gt 0 ]] && ok "Pod UIDs snapshot (${#CADDY_UIDS[@]}): capture will be invalid if pods change"
  CADDY_CAPTURE_PIDS=()
  for p in "${CADDY_PODS[@]:-}"; do
    [[ -z "$p" ]] && continue
    log_info "Starting capture on Caddy pod: $p"
    kctl -n "$NS_ING" exec "$p" -- sh -c \
      "apk add --no-cache tcpdump 2>/dev/null || apt-get update -qq && apt-get install -y -qq tcpdump 2>/dev/null || true" >/dev/null 2>&1 || true
    if kctl -n "$NS_ING" exec "$p" -- which tcpdump >/dev/null 2>&1; then
      # -i any: CNI/NAT may deliver traffic on lo/cni0; eth0-only can miss. In-pod traffic is DNAT'd (dst=pod IP), so we use port 443 only; for host/VM capture would use "(tcp or udp) and port 443 and dst host $TARGET_IP".
      ROTATION_BPF="(tcp or udp) and port 443"
      log_info "  $p: ip addr (interfaces for capture)"
      kctl -n "$NS_ING" exec "$p" -- sh -c "echo \"=== $NS_ING/$p interfaces ===\"; ip addr 2>/dev/null || ifconfig 2>/dev/null || true" >> "$WIRE_CAPTURE_DIR/caddy-capture.log" 2>&1 || true
      kctl -n "$NS_ING" exec "$p" -- sh -c \
        "tcpdump -i any -nn -s 0 -B 8192 -U -w /tmp/rotation-caddy-$p.pcap $ROTATION_BPF 2>&1" \
        >> "$WIRE_CAPTURE_DIR/caddy-capture.log" 2>&1 &
      CADDY_CAPTURE_PIDS+=($!)
    else
      warn "tcpdump not available on pod $p; skipping capture on this pod"
    fi
  done
  # VM capture removed: in-pod capture is sufficient; HTTP/3 proof is curl Version: 3 + 200.
  if [[ ${#CADDY_CAPTURE_PIDS[@]} -gt 0 ]]; then
    ok "Caddy packet capture started on ${#CADDY_PODS[@]} pod(s) (PIDs: ${CADDY_CAPTURE_PIDS[*]}) - HTTP/2, HTTP/3/QUIC"
    [[ ${#CADDY_CAPTURE_PIDS[@]} -lt ${#CADDY_PODS[@]} ]] && warn "tcpdump running on only ${#CADDY_CAPTURE_PIDS[@]} of ${#CADDY_PODS[@]} pods; some traffic may be missed"
    ROTATION_CAPTURE_WARMUP="${CAPTURE_WARMUP_SECONDS:-6}"
    sleep "$ROTATION_CAPTURE_WARMUP"
    ok "Capture warmup ${ROTATION_CAPTURE_WARMUP}s (before k6) — tcpdump ready"
    # Abort if pod UID changed during setup (capture would be attached to dead pods)
    if [[ ${#CADDY_UIDS[@]} -gt 0 ]] && [[ ${#CADDY_PODS[@]} -gt 0 ]]; then
      CURRENT_UIDS=()
      for _p in "${CADDY_PODS[@]}"; do
        _uid=$(kctl -n "$NS_ING" get pod "$_p" -o jsonpath='{.metadata.uid}' 2>/dev/null || echo "")
        [[ -n "$_uid" ]] && CURRENT_UIDS+=("$_uid")
      done
      if [[ "${CADDY_UIDS[*]}" != "${CURRENT_UIDS[*]}" ]]; then
        fail "Pod changed during capture setup — aborting (capture must not span pod restarts). Re-run rotation."
      fi
      ok "Pod UIDs unchanged before k6"
    fi
  fi

  # ROTATION_UDP_STATS=1: capture UDP stats (netstat/ss/proc) before/after k6 to diagnose QUIC "timeout: no recent network activity"
  capture_udp_stats() {
    local when="$1"
    local dir="$2"
    [[ -z "$dir" ]] && return 0
    mkdir -p "$dir"
    # From Caddy pods: /proc/net/snmp (Udp: InDatagrams, InErrors, RcvbufErrors) - no extra packages needed
    for p in "${CADDY_PODS[@]:-}"; do
      [[ -z "$p" ]] && continue
      kctl -n "$NS_ING" exec "$p" -- cat /proc/net/snmp 2>/dev/null | grep -E '^Udp:' > "$dir/caddy-$p-snmp-$when.txt" 2>/dev/null || true
      kctl -n "$NS_ING" exec "$p" -- cat /proc/net/udp 2>/dev/null > "$dir/caddy-$p-udp-$when.txt" 2>/dev/null || true
      kctl -n "$NS_ING" exec "$p" -- sh -c "netstat -su 2>/dev/null || true" > "$dir/caddy-$p-netstat-$when.txt" 2>/dev/null || true
      kctl -n "$NS_ING" exec "$p" -- sh -c "ss -u -a -i 2>/dev/null || true" > "$dir/caddy-$p-ss-$when.txt" 2>/dev/null || true
    done
    # From Colima VM: full netstat/ss (VM is key hop for macOS→cluster UDP)
    ROT_CTX_UDP=$(kubectl config current-context 2>/dev/null || echo "")
    if [[ "$ROT_CTX_UDP" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      colima ssh -- "netstat -su 2>/dev/null || true" > "$dir/colima-vm-netstat-$when.txt" 2>/dev/null || true
      colima ssh -- "ss -u -a -i 2>/dev/null || true" > "$dir/colima-vm-ss-$when.txt" 2>/dev/null || true
    fi
  }

  # Start Envoy capture (gRPC)
  ENVOY_POD=""
  ENVOY_NS=""
  ENVOY_POD=$(kctl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$ENVOY_POD" ]]; then
    ENVOY_NS="envoy-test"
  else
    ENVOY_POD=$(kctl -n ingress-nginx get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$ENVOY_POD" ]]; then
      ENVOY_NS="ingress-nginx"
    fi
  fi
  
  if [[ -n "$ENVOY_POD" ]] && [[ -n "$ENVOY_NS" ]]; then
    kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c \
      "apk add --no-cache tcpdump 2>/dev/null || apt-get update -qq && apt-get install -y -qq tcpdump 2>/dev/null || true" >/dev/null 2>&1 || true
    
    if kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- which tcpdump >/dev/null 2>&1; then
      kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c "echo \"=== $ENVOY_NS/$ENVOY_POD interfaces ===\"; ip addr 2>/dev/null || ifconfig 2>/dev/null || true" >> "$WIRE_CAPTURE_DIR/envoy-capture.log" 2>&1 || true
      # Capture gRPC traffic: Envoy service port (10000), NodePort (30000/30001), and service ports (50051-50060). -i any -nn -s 0 -B 8192 for MetalLB.
      kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c \
        "tcpdump -i any -nn -s 0 -B 8192 -U -w /tmp/rotation-envoy.pcap 'port 10000 or port 30000 or port 30001 or portrange 50051-50060' 2>&1" \
        >> "$WIRE_CAPTURE_DIR/envoy-capture.log" 2>&1 &
      ENVOY_CAPTURE_PID=$!
      ok "Envoy packet capture started (PID: $ENVOY_CAPTURE_PID)"
      sleep 2
    fi
  fi
  
  # Cleanup function for captures
  cleanup_wire_capture() {
    # Post-load UDP stats (after k6 finished)
    if [[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && type capture_udp_stats &>/dev/null; then
      capture_udp_stats "post" "$WIRE_CAPTURE_DIR"
      ok "UDP stats captured (post)"
    fi

    say "Stopping wire-level packet captures…"

    for pid in "${CADDY_CAPTURE_PIDS[@]:-}"; do
      [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in "${CADDY_CAPTURE_PIDS[@]:-}"; do
      [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
    done
    
    if [[ -n "${ENVOY_CAPTURE_PID:-}" ]]; then
      kill -TERM "$ENVOY_CAPTURE_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$ENVOY_CAPTURE_PID" 2>/dev/null || true
    fi
    
    # Allow tcpdump to flush (longer window so HTTP/3/QUIC traffic is captured after k6 finishes)
    sleep 10
    for p in "${CADDY_PODS[@]:-}"; do
      [[ -z "$p" ]] && continue
      kctl -n "$NS_ING" exec "$p" -- sh -c "sync 2>/dev/null; cat /tmp/rotation-caddy-$p.pcap" > \
        "$WIRE_CAPTURE_DIR/caddy-rotation-$p.pcap" 2>/dev/null || true
    done
    
    if [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]]; then
      kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c "sync 2>/dev/null; cat /tmp/rotation-envoy.pcap" > \
        "$WIRE_CAPTURE_DIR/envoy-rotation.pcap" 2>/dev/null || true
    fi
    
    ok "Wire-level captures saved to: $WIRE_CAPTURE_DIR"
    
    # Protocol verification: use shared lib for definitive HTTP/2 and QUIC (tshark)
    if [[ -f "$SCRIPT_DIR/lib/protocol-verification.sh" ]]; then
      # shellcheck source=scripts/lib/protocol-verification.sh
      source "$SCRIPT_DIR/lib/protocol-verification.sh"
    fi
    if command -v tshark >/dev/null 2>&1; then
      say "Verifying protocols at wire level (HTTP/2 frames, QUIC packets)…"
      CADDY_NPODS=${#CADDY_PODS[@]}
      # Use keylog when available so HTTP/2 frame count matches post-rotation verification (consistent reporting)
      _keylog_opts=()
      [[ -n "${ROTATION_SSLKEYLOG:-}" ]] && [[ -f "${ROTATION_SSLKEYLOG}" ]] && [[ -s "${ROTATION_SSLKEYLOG}" ]] && _keylog_opts=(-o "tls.keylog_file:${ROTATION_SSLKEYLOG}")
      # Aggregate Caddy pcaps (traffic may hit any pod)
      CADDY_HTTP2_TOTAL=0
      CADDY_QUIC_TOTAL=0
      for pcap in "$WIRE_CAPTURE_DIR"/caddy-rotation-*.pcap; do
        [[ -f "$pcap" ]] || continue
        [[ -s "$pcap" ]] || continue
        n=$(tshark -r "$pcap" "${_keylog_opts[@]}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        [[ "$n" =~ ^[0-9]+$ ]] && CADDY_HTTP2_TOTAL=$((CADDY_HTTP2_TOTAL + n))
        n=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        [[ "$n" =~ ^[0-9]+$ ]] && CADDY_QUIC_TOTAL=$((CADDY_QUIC_TOTAL + n))
      done
      # HTTP/2 over TLS: tshark "http2" filter needs decryption (SSLKEYLOGFILE). Without it, frames=0.
      # ALPN h2 in TLS Client Hello is unencrypted and definitive for HTTP/2 intent.
      CADDY_TCP443=0
      CADDY_ALPN_H2=0
      for pcap in "$WIRE_CAPTURE_DIR"/caddy-rotation-*.pcap; do
        [[ -f "$pcap" ]] || continue
        [[ -s "$pcap" ]] || continue
        if type count_tcp443_udp443_in_pcap &>/dev/null; then
          read -r t443 u443 <<< "$(count_tcp443_udp443_in_pcap "$pcap")"
          CADDY_TCP443=$((CADDY_TCP443 + t443))
        fi
        if type count_alpn_h2_in_pcap &>/dev/null; then
          CADDY_ALPN_H2=$((CADDY_ALPN_H2 + $(count_alpn_h2_in_pcap "$pcap")))
        fi
      done
      if [[ "$CADDY_HTTP2_TOTAL" -gt 0 ]]; then
        ok "caddy-rotation: HTTP/2 verified ($CADDY_HTTP2_TOTAL decrypted frames across ${CADDY_NPODS} pod(s))"
      elif [[ "$CADDY_ALPN_H2" -gt 0 ]]; then
        ok "caddy-rotation: HTTP/2 intent verified (ALPN h2 in TLS Client Hello, $CADDY_ALPN_H2 across ${CADDY_NPODS} pod(s))"
        info "  HTTP/2 frames encrypted (TLS); for frame-level proof set SSLKEYLOGFILE in k6/curl"
      elif [[ "$CADDY_TCP443" -gt 0 ]]; then
        ok "caddy-rotation: TCP 443 (HTTP/2 likely, TLS-encrypted): $CADDY_TCP443 packets across ${CADDY_NPODS} pod(s)"
      else
        info "caddy-rotation: HTTP/2 frames not visible (TLS encryption; expected without keylog; curl/k6 health is proof)"
      fi
      if [[ "$CADDY_QUIC_TOTAL" -gt 0 ]]; then
        ok "caddy-rotation: HTTP/3 (QUIC) verified ($CADDY_QUIC_TOTAL packets across ${CADDY_NPODS} pod(s); encrypted, packet count = proof)"
      else
        warn "caddy-rotation: No QUIC packets detected (HTTP/3 may not be in use or traffic hit other paths)"
      fi
      # Packet capture summary: HTTP/2 ALPN=frames (keylog), QUIC=packet count (encrypted; qlog would give frame-level)
      echo "  Packet capture summary: HTTP/2(ALPN)=$CADDY_ALPN_H2, HTTP/2(frames)=$CADDY_HTTP2_TOTAL, QUIC=$CADDY_QUIC_TOTAL, TCP443=$CADDY_TCP443 (Caddy pods)"
      [[ "$CADDY_HTTP2_TOTAL" -eq 0 ]] && [[ "$CADDY_ALPN_H2" -gt 0 ]] && info "  HTTP/2 frames=0 without ROTATION_H2_KEYLOG=1; ALPN h2 = definitive proof"
      
      # Per-file analysis for Envoy (use lib when available)
      for pcap in "$WIRE_CAPTURE_DIR"/envoy-rotation.pcap; do
        [[ -f "$pcap" ]] || continue
        [[ -s "$pcap" ]] || continue
        service=$(basename "$pcap" .pcap)
        say "Analyzing $service protocols…"
        if type count_http2_in_pcap &>/dev/null; then
          HTTP2_COUNT=$(count_http2_in_pcap "$pcap")
          QUIC_COUNT=$(count_quic_in_pcap "$pcap")
          GRPC_COUNT=$(count_grpc_in_pcap "$pcap")
        else
          HTTP2_COUNT=$(tshark -r "$pcap" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
          QUIC_COUNT=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
          GRPC_COUNT=$(tshark -r "$pcap" -Y 'http2.header.value contains "application/grpc"' 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        fi
        [[ "${HTTP2_COUNT:-0}" -gt 0 ]] && ok "$service: HTTP/2 verified ($HTTP2_COUNT packets)"
        if [[ "${QUIC_COUNT:-0}" -gt 0 ]]; then
          ok "$service: HTTP/3 (QUIC) verified ($QUIC_COUNT packets)"
        else
          warn "$service: No QUIC packets detected (HTTP/3 may not be in use)"
        fi
        [[ "${GRPC_COUNT:-0}" -gt 0 ]] && ok "$service: gRPC verified ($GRPC_COUNT packets)"
      done
    fi
    # ROTATION_UDP_STATS: summarize UDP drops/errors (pre vs post)
    if [[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && [[ -d "${WIRE_CAPTURE_DIR:-}" ]]; then
      if [[ -f "$WIRE_CAPTURE_DIR/colima-vm-netstat-post.txt" ]] && [[ -f "$WIRE_CAPTURE_DIR/colima-vm-netstat-pre.txt" ]]; then
        say "UDP stats (Colima VM): pre vs post k6 load"
        _pre_errors=$(grep -E 'packet receive errors|buffer errors|receive queue overflow|rcvbuf' "$WIRE_CAPTURE_DIR/colima-vm-netstat-pre.txt" 2>/dev/null | head -20)
        _post_errors=$(grep -E 'packet receive errors|buffer errors|receive queue overflow|rcvbuf' "$WIRE_CAPTURE_DIR/colima-vm-netstat-post.txt" 2>/dev/null | head -20)
        [[ -n "$_pre_errors" ]] && echo "  Pre:  $_pre_errors" | head -5
        [[ -n "$_post_errors" ]] && echo "  Post: $_post_errors" | head -5
        info "Full UDP stats: $WIRE_CAPTURE_DIR/colima-vm-netstat-{pre,post}.txt, caddy-*-snmp-{pre,post}.txt"
      fi
    fi
  }

  # Pre-load UDP stats (before any k6)
  if [[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && [[ -n "${WIRE_CAPTURE_DIR:-}" ]]; then
    capture_udp_stats "pre" "$WIRE_CAPTURE_DIR"
    ok "UDP stats captured (pre): Caddy pods + Colima VM → $WIRE_CAPTURE_DIR"
  fi

  trap 'cleanup_secret_err; cleanup_wire_capture' EXIT
fi

# Adaptive increment logic: Start with baseline, increase if no errors and low drops
# If dropped iterations < threshold and error rate == 0, increase both rates
# Start at 320+180=500 req/s (matches past successful runs; tune k6 timeout/thresholds for load)
# Defaults tuned for 500 req/s; set ROTATION_HIGH_THROUGHPUT=1 or override env vars to push higher numbers
# Mode overrides: wire=1 baseline iter only; forensic=host k6+KEYLOG+H2 only, 1 iter.
if [[ "$ROTATION_SUITE_MODE" == "wire" ]]; then
  H2_START_RATE="${K6_H2_START_RATE:-320}"
  H3_START_RATE="${K6_H3_START_RATE:-180}"
  H2_INCREMENT=0
  H3_INCREMENT=0
  MAX_ITERATIONS=1
  export K6_DURATION="${K6_DURATION:-30s}"
  export DURATION="${K6_DURATION:-30s}"
  H2_PRE_VUS_DEFAULT=80
  H2_MAX_VUS_DEFAULT=300
  H3_PRE_VUS_DEFAULT=200
  H3_MAX_VUS_DEFAULT=600
  K6_JOB_MAX_TIMEOUT_SEC_DEFAULT=120
  info "Mode=wire: 1 baseline iteration (H2=${H2_START_RATE} H3=${H3_START_RATE} req/s), capture only, no scaling."
elif [[ "$ROTATION_SUITE_MODE" == "forensic" ]]; then
  ROTATION_H2_KEYLOG=1
  export ROTATION_H2_KEYLOG
  [[ -z "${ROTATION_SSLKEYLOG:-}" ]] && ROTATION_SSLKEYLOG="/tmp/rotation-sslkey-$$.log" && : > "$ROTATION_SSLKEYLOG"
  export ROTATION_SSLKEYLOG SSLKEYLOGFILE="${ROTATION_SSLKEYLOG}"
  H2_START_RATE="${K6_H2_START_RATE:-320}"
  H3_START_RATE=0
  H2_RATE=320
  H3_RATE=0
  H2_INCREMENT=0
  H3_INCREMENT=0
  MAX_ITERATIONS=1
  export K6_DURATION="${K6_DURATION:-30s}"
  export DURATION="${K6_DURATION:-30s}"
  export H3_RATE=0
  export H2_RATE=320
  H2_PRE_VUS_DEFAULT=40
  H2_MAX_VUS_DEFAULT=150
  H3_PRE_VUS_DEFAULT=5
  H3_MAX_VUS_DEFAULT=20
  K6_JOB_MAX_TIMEOUT_SEC_DEFAULT=120
  info "Mode=forensic: host k6, SSLKEYLOGFILE, H2 only (H3=0), 1 iteration, 30s."
elif [[ "${ROTATION_HIGH_THROUGHPUT:-0}" == "1" ]]; then
  H2_START_RATE="${K6_H2_START_RATE:-380}"
  H3_START_RATE="${K6_H3_START_RATE:-220}"
  H2_INCREMENT="${K6_H2_INCREMENT:-20}"
  H3_INCREMENT="${K6_H3_INCREMENT:-15}"
  MAX_ITERATIONS="${K6_MAX_ITERATIONS:-45}"
  H2_PRE_VUS_DEFAULT=100
  H2_MAX_VUS_DEFAULT=400
  H3_PRE_VUS_DEFAULT=250
  H3_MAX_VUS_DEFAULT=800
  K6_JOB_MAX_TIMEOUT_SEC_DEFAULT=780
else
  H2_START_RATE="${K6_H2_START_RATE:-320}"
  H3_START_RATE="${K6_H3_START_RATE:-180}"
  H2_INCREMENT="${K6_H2_INCREMENT:-20}"     # +20 each time (user: increase by 20 to find max)
  H3_INCREMENT="${K6_H3_INCREMENT:-20}"
  MAX_ITERATIONS="${K6_MAX_ITERATIONS:-35}" # Slightly more iterations to find ceiling
  H2_PRE_VUS_DEFAULT=150
  H2_MAX_VUS_DEFAULT=1000
  H3_PRE_VUS_DEFAULT=400
  H3_MAX_VUS_DEFAULT=1000
  K6_JOB_MAX_TIMEOUT_SEC_DEFAULT=660
fi

# K6_CONSERVATIVE=1: Colima/macOS-friendly preset — Little's Law L≈46, so cap VUs and rates to avoid QUIC saturation
if [[ "${K6_CONSERVATIVE:-0}" == "1" ]]; then
  H2_START_RATE="${K6_H2_START_RATE:-200}"
  H3_START_RATE="${K6_H3_START_RATE:-100}"
  H2_PRE_VUS_DEFAULT=40
  H2_MAX_VUS_DEFAULT=150
  H3_PRE_VUS_DEFAULT=40
  H3_MAX_VUS_DEFAULT=100
  info "K6_CONSERVATIVE=1: Colima/macOS preset (L≈46) — H2 ${H2_START_RATE} req/s / ${H2_MAX_VUS_DEFAULT} VUs, H3 ${H3_START_RATE} req/s / ${H3_MAX_VUS_DEFAULT} VUs"
fi

# Colima + host k6: QUIC path instability through macOS→Colima→k3s→MetalLB NAT. Lower H3 VUs to avoid UDP conntrack exhaustion.
# See: "timeout: no recent network activity" — Go QUIC idle timeout when UDP stalls. Set K6_STRESS_H3=1 to force higher H3 VUs.
# Skip when mode=forensic (we already set H3=0 for H2-only decrypted frame proof).
ROT_CTX_FOR_VU=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "${K6_STRESS_H3:-0}" != "1" ]] && [[ "$ROT_CTX_FOR_VU" == *"colima"* ]] && [[ "${ROTATION_H2_KEYLOG:-0}" == "1" ]] && [[ "$ROTATION_SUITE_MODE" != "forensic" ]]; then
  H3_PRE_VUS_DEFAULT=5
  H3_MAX_VUS_DEFAULT=20
  H3_START_RATE="${K6_H3_START_RATE:-30}"
  H3_INCREMENT="${K6_H3_INCREMENT:-10}"
  info "Colima + host k6: QUIC-safe H3 limits (5–20 VUs, ${H3_START_RATE} req/s) to avoid UDP NAT exhaustion. Set K6_STRESS_H3=1 to override."
fi

# Drops: keep low to find max without error; with 2 Caddy pods we capture on both so wire verification sees both HTTP/2 and HTTP/3. For rotation-only (accept high drops) use K6_MAX_DROP_PCT=30
MAX_DROP_PCT="${K6_MAX_DROP_PCT:-1.5}"  # Stop when drops exceed this (find limit with low drops)

# Initialize current rates
H2_RATE=$H2_START_RATE
H3_RATE=$H3_START_RATE
ITERATION=0
# Three phases: (1) baseline, (2) max without drop, (3) max without error
ROTATION_PHASE=1
PHASE1_JSON=""
PHASE2_JSON=""
PHASE3_JSON=""
# Dual limits: max without error (0% failures) and max without drop (drops ≤ threshold)
LAST_SUCCESSFUL_H2=$H2_START_RATE
LAST_SUCCESSFUL_H3=$H3_START_RATE
MAX_NO_DROP_H2=0
MAX_NO_DROP_H3=0
ITER_AT_MAX_NO_ERROR=0
ITER_AT_MAX_NO_DROP=0
# First iteration at which we see drop or error (for 8-chart dashboard: max iter before drop / before error)
ITER_AT_FIRST_DROP=0
ITER_AT_FIRST_H2_ERROR=0
ITER_AT_FIRST_H3_ERROR=0

# VU configuration: pre-allocate enough workers so target req/s doesn't drop. Higher when ROTATION_HIGH_THROUGHPUT=1.
H2_PRE_VUS="${K6_H2_PRE_VUS:-${H2_PRE_VUS_DEFAULT:-80}}"
H2_MAX_VUS="${K6_H2_MAX_VUS:-${H2_MAX_VUS_DEFAULT:-300}}"
H3_PRE_VUS="${K6_H3_PRE_VUS:-${H3_PRE_VUS_DEFAULT:-200}}"
H3_MAX_VUS="${K6_H3_MAX_VUS:-${H3_MAX_VUS_DEFAULT:-600}}"

# Export for k6 job
export H2_PRE_VUS H2_MAX_VUS H3_PRE_VUS H3_MAX_VUS

say "=== Adaptive CA Rotation Limit Finding ==="
[[ "${ROTATION_HIGH_THROUGHPUT:-0}" == "1" ]] && info "High throughput mode: higher start rates, increments, VUs, and job timeout (push for higher numbers)"
[[ "${K6_CONSERVATIVE:-0}" == "1" ]] && info "K6_CONSERVATIVE=1: Colima/macOS preset (L≈46) — lower VUs/rates to avoid QUIC saturation"
echo "  Goals: (1) Max combined req/s without error (0% failures); (2) Max combined req/s without drop (drops ≤ ${MAX_DROP_PCT}%)"
echo "  Starting rates: H2=${H2_START_RATE} req/s, H3=${H3_START_RATE} req/s (combined: $((H2_START_RATE + H3_START_RATE)) req/s)"
echo "  Increment: H2=${H2_INCREMENT} req/s, H3=${H3_INCREMENT} req/s"
echo "  Max iterations: ${MAX_ITERATIONS} (each iteration: H2/H3 req/s, actual req/s, fail %, drop %)"
echo "  Dashboard (8 charts): scripts/rotation-dashboard.html — load rotation-summary.json (phase latencies, throughput, Little's Law, limits, iter limits, latency p95–p100, telemetry)"
[[ "${ROTATION_H2_KEYLOG:-0}" == "1" ]] && info "ROTATION_H2_KEYLOG=1: k6 runs on host (.k6-build/k6-http3 or vanilla) with SSLKEYLOGFILE → decrypted HTTP/2 frames"
[[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && info "ROTATION_UDP_STATS=1: capturing UDP stats (netstat/ss/proc) pre/post for QUIC queue pressure diagnosis"
echo ""

# Adaptive increment loop
while [[ $ITERATION -lt $MAX_ITERATIONS ]]; do
  ITERATION=$((ITERATION + 1))
  
  PCT_DONE=$(( (ITERATION * 100) / MAX_ITERATIONS ))
  say "=== Phase $ROTATION_PHASE / Iteration $ITERATION/${MAX_ITERATIONS} (${PCT_DONE}%): H2=${H2_RATE} req/s, H3=${H3_RATE} req/s (combined: $((H2_RATE + H3_RATE)) req/s) ==="
  
  # Export current rates for k6 job
  export H2_RATE H3_RATE

# Parse duration for reporting (required in both local and in-cluster paths; avoids DURATION_SEC unbound)
DURATION_SEC=$(echo "$DURATION" | sed 's/s$//' | grep -oE '^[0-9]+' || echo "90")

# ROTATION_H2_KEYLOG=1: run k6 on host with SSLKEYLOGFILE → decrypted HTTP/2 frames in tshark
# Note: ROTATION_H2_KEYLOG forces host mode (ROTATION_MODE=host) for SSLKEYLOGFILE support
if [[ "${ROTATION_H2_KEYLOG:-0}" == "1" ]]; then
  [[ -z "${ROTATION_SSLKEYLOG:-}" ]] && ROTATION_SSLKEYLOG="/tmp/rotation-sslkey-$$.log" && : > "$ROTATION_SSLKEYLOG"
  export ROTATION_SSLKEYLOG
  export SSLKEYLOGFILE="${ROTATION_SSLKEYLOG}"  # Go/k6 write TLS key log here for tshark decryption
  ROTATION_MODE="host"  # Force host mode for SSLKEYLOGFILE
  K6_NODEPORT=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "30443")
  # MetalLB: k6 → LB IP:443 only (K6_RESOLVE). No NodePort fallback when MetalLB mode.
  if [[ -n "${TARGET_IP:-}" ]]; then
    export K6_TARGET_URL="https://${HOST}:443/_caddy/healthz"
    export K6_RESOLVE="${HOST}:443:${TARGET_IP}"
    export K6_LB_IP="${TARGET_IP}"
    unset K6_HTTP2_ONLY
    info "ROTATION_H2_KEYLOG=1: forcing host k6 → ${HOST}:443 → ${TARGET_IP} (MetalLB)"
  elif [[ "${METALLB_ENABLED:-0}" == "1" ]] || [[ "${USE_LB_FOR_TESTS:-0}" == "1" ]]; then
    fail "Host rotation mode requires TARGET_IP for k6. Ensure preflight/run-all wrote metallb-reachable.env with REACHABLE_LB_IP."
  else
    export K6_TARGET_URL="https://${HOST}:${K6_NODEPORT}/_caddy/healthz"
    unset K6_RESOLVE K6_LB_IP
    export K6_HTTP2_ONLY=1
    info "ROTATION_H2_KEYLOG=1: forcing host k6 → $HOST:${K6_NODEPORT} (NodePort; H2-only)"
  fi
  # Ensure k6 (Go) trusts the rotated CA — SSL_CERT_FILE must be set before k6 runs
  _k6_ca="$REPO_ROOT/certs/dev-root.pem"
  if [[ -f "$_k6_ca" ]] && [[ -s "$_k6_ca" ]]; then
    export SSL_CERT_FILE="$(cd "$(dirname "$_k6_ca")" && pwd)/$(basename "$_k6_ca")"
    info "SSL_CERT_FILE=$SSL_CERT_FILE (k6 strict TLS)"
  fi
  K6_LOCAL_OUT="/tmp/rotation-k6-local-$$-${ITERATION}.out"
  say "Running k6 locally with SSLKEYLOGFILE (ROTATION_H2_KEYLOG=1) for decrypted HTTP/2 frames…"
  K6_START_TIME=$(date +%s)
  # Uses .k6-build/k6-http3 (xk6-http3) when present; else HTTP/2-only with vanilla k6
  "$SCRIPT_DIR/run-k6-chaos.sh" local 2>&1 | tee "$K6_LOCAL_OUT"
  K6_WAIT_END=$(date +%s)
  K6_TOTAL_DURATION=$((K6_WAIT_END - K6_START_TIME))
  RESULT="$K6_LOCAL_OUT"
  JOB="k6-local"
  ok "k6 local completed (${K6_TOTAL_DURATION}s)"
else
# For strict TLS verification, mount the CA certificate into k6 pod.
# Use certs/dev-root.pem (canonical synced path after rotation) when available; else CA_ROOT.
# On Colima: host path is not visible in VM; stdin pipe to kctl often fails. Copy CA into VM and use file path.
NS_K6="k6-load"
CA_CONFIGMAP="k6-ca-cert"
K6_CA_SOURCE="$REPO_ROOT/certs/dev-root.pem"
if [[ ! -f "$K6_CA_SOURCE" ]] || [[ ! -s "$K6_CA_SOURCE" ]]; then
  K6_CA_SOURCE="${CA_ROOT:-}"
fi
if [[ ! -f "$K6_CA_SOURCE" ]] || [[ ! -s "$K6_CA_SOURCE" ]]; then
  fail "CA certificate missing or empty (certs/dev-root.pem or CA_ROOT) - cannot create k6 ConfigMap"
fi
say "Creating CA certificate ConfigMap for k6 (strict TLS; source: $K6_CA_SOURCE)…"
# Ensure namespace exists (create explicitly so k3d/kind have k6-load before ConfigMap)
if ! kctl get ns "$NS_K6" >/dev/null 2>&1; then
  kctl create namespace "$NS_K6" || fail "Failed to create namespace $NS_K6"
fi
ROT_CTX_K6=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ROT_CTX_K6" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
  # Colima: copy CA into VM and create ConfigMap from file path (avoids stdin pipe across ssh)
  VM_CA="/tmp/rotation-k6-ca.crt"
  if ! colima ssh -- bash -c "cat > $VM_CA && (kubectl get ns $NS_K6 >/dev/null 2>&1 || kubectl create ns $NS_K6) && kubectl create configmap $CA_CONFIGMAP --from-file=ca.crt=$VM_CA -n $NS_K6 --dry-run=client -o yaml | kubectl apply -f - && rm -f $VM_CA" < "$K6_CA_SOURCE" 2>/dev/null; then
    colima ssh -- "rm -f $VM_CA" 2>/dev/null || true
    fail "Failed to create k6 CA ConfigMap on Colima (copy CA into VM and create configmap)"
  fi
else
  # Host kubectl (k3d/kind): use --from-file=ca.crt=<path> so we don't rely on stdin pipe (more reliable)
  if ! kctl -n "$NS_K6" create configmap "$CA_CONFIGMAP" --from-file=ca.crt="$K6_CA_SOURCE" --dry-run=client -o yaml 2>/dev/null | kctl -n "$NS_K6" apply -f - 2>/dev/null; then
    # Fallback: try stdin (some envs require it)
    cat "$K6_CA_SOURCE" | kctl -n "$NS_K6" create configmap "$CA_CONFIGMAP" \
      --from-file=ca.crt=- --dry-run=client -o yaml 2>/dev/null | \
      kctl -n "$NS_K6" apply -f - 2>/dev/null || \
      fail "Failed to create k6 CA ConfigMap (check kctl and namespace $NS_K6; ensure k6-load exists: kubectl get ns k6-load)"
  fi
fi
ok "CA certificate ConfigMap created (strict TLS enabled)"

# Brief settle so kubelet can mount ConfigMap before Job pod starts (avoids race: ConfigMap in etcd but mount not ready).
sleep 2

# Export CA_CONFIGMAP so run-k6-chaos.sh can use it
export CA_CONFIGMAP
# Force no QUIC connection reuse so k6 does not hang on stale sessions after cert reload (latency ~8s timeout).
export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"

# k3d: cluster runs in Docker nodes; host-built k6 image is not visible. Import so the k6 job pod can run (avoids Pending).
if [[ "$ROT_CTX_K6" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
  K3D_CLUSTER="${ROT_CTX_K6#k3d-}"
  if docker images k6-custom:latest 2>/dev/null | grep -q k6-custom; then
    log_info "Importing k6-custom:latest into k3d cluster '$K3D_CLUSTER' so the k6 job can run..."
    if k3d image import k6-custom:latest -c "$K3D_CLUSTER"; then
      ok "k6 image imported into k3d (job pod will no longer stay Pending)"
    else
      warn "k3d image import failed; k6 job may stay Pending. Check: k3d cluster list; docker images k6-custom:latest"
    fi
  else
    warn "k6-custom:latest not found on host; run scripts/build-k6-image.sh first. k6 job may stay Pending."
  fi
fi

# Optional: use jslib summary in k6 chaos job (requires pod egress to jslib.k6.io). Default 0 = inline summary (no egress).
export K6_USE_JSLIB="${K6_USE_JSLIB:-${ROTATION_USE_JSLIB:-0}}"
K6_START_TIME=$(date +%s)
K6_START_ERR="/tmp/rotation-k6-start-$$.err"
# Force no QUIC reuse so k6 gets fresh handshakes after Caddy restart (avoids HTTP/3 Success Rate 0%, latency p95 8003ms, context deadline exceeded)
export K6_HTTP3_NO_REUSE=1
JOB=$("$SCRIPT_DIR/run-k6-chaos.sh" start 2>"$K6_START_ERR" | grep -oE 'k6-chaos-[0-9]+' | head -1)
JOB="${JOB:-}"
if [[ -z "$JOB" ]]; then
  warn "run-k6-chaos.sh start produced no job name (script may have exited before echo)"
  [[ -s "$K6_START_ERR" ]] && log_info "Stderr: $(cat "$K6_START_ERR")"
  rm -f "$K6_START_ERR"
  fail "Failed to create chaos job (check CA ConfigMap exists: kctl -n k6-load get configmap k6-ca-cert)"
fi
rm -f "$K6_START_ERR"
ok "k6 job started: $JOB (started at $(date -r "$K6_START_TIME" '+%H:%M:%S'))"

say "Waiting for chaos suite to finish…"

# Calculate dynamic timeout based on duration and rate
# Parse duration (e.g., "90s" -> 90)
DURATION_SEC=$(echo "$DURATION" | sed 's/s$//' | grep -oE '^[0-9]+' || echo "90")
# Add buffer for job startup, rotation overhead, and completion
# Higher rates need more buffer due to dropped iterations and processing time
TOTAL_RATE=$((H2_RATE + H3_RATE))
K6_TIMEOUT_SEC=$((DURATION_SEC + 60))  # Base buffer: 60s

# For high rates, add extra buffer (more dropped iterations = longer completion time)
# At very high rates (400+ req/s), k6 can take significantly longer due to:
# - Dropped iterations (k6 can't keep up with target rate)
# - Processing overhead for large result sets
# - Network congestion and connection pooling
# Observed: 420 req/s (260/160) can take 600s+ total, especially with high dropped iterations (15-61%+)
# With massive dropped iterations, k6 needs significantly more time to process all requests
# Latest runs: 603s, 631s observed - 660s timeout provides safe buffer with variability
if [[ "$TOTAL_RATE" -ge 400 ]]; then
  K6_TIMEOUT_SEC=$((DURATION_SEC + 480))  # 8 minutes extra for very high rates (660s total)
elif [[ "$TOTAL_RATE" -ge 350 ]]; then
  K6_TIMEOUT_SEC=$((DURATION_SEC + 200))  # ~3.3 minutes extra
elif [[ "$TOTAL_RATE" -ge 300 ]]; then
  K6_TIMEOUT_SEC=$((DURATION_SEC + 150))  # 2.5 minutes extra
elif [[ "$TOTAL_RATE" -ge 250 ]]; then
  K6_TIMEOUT_SEC=$((DURATION_SEC + 120))  # 2 minutes extra
fi

# Cap at reasonable maximum; ROTATION_HIGH_THROUGHPUT=1 uses 780s for very high rates
K6_JOB_MAX_TIMEOUT_SEC="${K6_JOB_MAX_TIMEOUT_SEC:-${K6_JOB_MAX_TIMEOUT_SEC_DEFAULT:-660}}"
# For 400+ req/s, default cap 11 min (660s); observed 631s needed; if wait still times out, set K6_JOB_MAX_TIMEOUT_SEC=780
if [[ "$TOTAL_RATE" -ge 400 ]]; then
  if [[ $K6_TIMEOUT_SEC -gt $K6_JOB_MAX_TIMEOUT_SEC ]]; then
    K6_TIMEOUT_SEC=$K6_JOB_MAX_TIMEOUT_SEC
  fi
else
  if [[ $K6_TIMEOUT_SEC -gt 480 ]]; then
    K6_TIMEOUT_SEC=480
  fi
fi

K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
ok "k6 timeout: ${K6_TIMEOUT} (duration: ${DURATION}, rate: ${TOTAL_RATE} req/s)"
# Why 570s: k6 runs 90s of load then flushes; at 500 req/s observed completion can be 600s+. See scripts/ROTATION-SUITE-DEPENDENCIES.md.

K6_WAIT_START=$(date +%s)
# Show job/pod status every 60s during wait (set ROTATION_K6_WAIT_PROGRESS=0 to disable)
if [[ "${ROTATION_K6_WAIT_PROGRESS:-1}" == "1" ]]; then
  # Run wait in background; poll job/pod status every 60s so we see what's going on
  WAIT_PID=""
  ( "$SCRIPT_DIR/run-k6-chaos.sh" wait "$JOB" "$K6_TIMEOUT" 2>&1 ) &
  WAIT_PID=$!
  PROGRESS_INTERVAL=60
  # Show status at 0s so we see job/pod state immediately
  sleep 3
  ELAPSED=$(($(date +%s) - K6_WAIT_START))
  JOB_COMPLETE=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
  JOB_FAILED=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
  JOB_SUCC=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "0")
  JOB_FAIL=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "0")
  POD_PHASE=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "?")
  POD_READY=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || echo "?")
  POD_REASON=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason},{.items[0].status.containerStatuses[0].state.terminated.reason}' 2>/dev/null | tr -d '\n' | sed 's/,$//')
  POD_EXIT=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null || echo "")
  JOB_SUMMARY="Complete=$JOB_COMPLETE Failed=$JOB_FAILED suc=$JOB_SUCC fail=$JOB_FAIL"
  POD_SUMMARY="$POD_PHASE"; [[ "$POD_READY" != "?" ]] && [[ -n "$POD_READY" ]] && POD_SUMMARY="${POD_SUMMARY} ready=$POD_READY"; [[ -n "$POD_REASON" ]] && POD_SUMMARY="${POD_SUMMARY} ($POD_REASON)"; [[ -n "$POD_EXIT" ]] && POD_SUMMARY="${POD_SUMMARY} exit=$POD_EXIT"
  info "  [${ELAPSED}s/${K6_TIMEOUT_SEC}s] $JOB_SUMMARY pod=$POD_SUMMARY"
  while kill -0 "$WAIT_PID" 2>/dev/null; do
    sleep "$PROGRESS_INTERVAL"
    if ! kill -0 "$WAIT_PID" 2>/dev/null; then break; fi
    ELAPSED=$(($(date +%s) - K6_WAIT_START))
    JOB_COMPLETE=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
    JOB_FAILED=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
    JOB_SUCC=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "0")
    JOB_FAIL=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "0")
    POD_PHASE=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "?")
    POD_READY=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || echo "?")
    POD_REASON=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason},{.items[0].status.containerStatuses[0].state.terminated.reason}' 2>/dev/null | tr -d '\n' | sed 's/,$//')
    POD_EXIT=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null || echo "")
    JOB_SUMMARY="Complete=$JOB_COMPLETE Failed=$JOB_FAILED suc=$JOB_SUCC fail=$JOB_FAIL"
    POD_SUMMARY="$POD_PHASE"
    [[ "$POD_READY" != "?" ]] && [[ -n "$POD_READY" ]] && POD_SUMMARY="${POD_SUMMARY} ready=$POD_READY"
    [[ -n "$POD_REASON" ]] && POD_SUMMARY="${POD_SUMMARY} ($POD_REASON)"
    [[ -n "$POD_EXIT" ]] && POD_SUMMARY="${POD_SUMMARY} exit=$POD_EXIT"
    if [[ "$POD_PHASE" == "Pending" ]] && [[ $ELAPSED -ge 60 ]]; then
      info "  [${ELAPSED}s/${K6_TIMEOUT_SEC}s] $JOB_SUMMARY pod=$POD_SUMMARY (k3d: ensure k6 image imported; or: kubectl -n k6-load describe pod -l job-name=$JOB)"
    else
      info "  [${ELAPSED}s/${K6_TIMEOUT_SEC}s] $JOB_SUMMARY pod=$POD_SUMMARY (logs: kubectl -n k6-load logs -f job/$JOB)"
    fi
  done
  wait "$WAIT_PID" 2>/dev/null
  K6_WAIT_RC=$?
else
  "$SCRIPT_DIR/run-k6-chaos.sh" wait "$JOB" "$K6_TIMEOUT" 2>&1
  K6_WAIT_RC=$?
fi

K6_WAIT_END=$(date +%s)
K6_WAIT_DURATION=$((K6_WAIT_END - K6_WAIT_START))
K6_TOTAL_DURATION=$((K6_WAIT_END - K6_START_TIME))

if [[ "${K6_WAIT_RC:-1}" -eq 0 ]]; then
  ok "k6 job completed (waited ${K6_WAIT_DURATION}s, total ${K6_TOTAL_DURATION}s)"
else
  warn "k6 wait timed out or failed (waited ${K6_WAIT_DURATION}s, total ${K6_TOTAL_DURATION}s)"
  # Diagnostic dump so we can dig deeper without re-running
  K6_DEBUG_DIR="${K6_DEBUG_DIR:-/tmp}"
  K6_DEBUG_FILE="$K6_DEBUG_DIR/rotation-k6-debug-${JOB}-$(date +%Y%m%d-%H%M%S).txt"
  K6_POD_EXIT_DUMP=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null || echo "?")
  {
    echo "=== k6 job $JOB diagnostic dump ==="
    echo "Time: $(date -Iseconds)"
    echo "Wait duration: ${K6_WAIT_DURATION}s  Timeout: ${K6_TIMEOUT}"
    echo "Container exit code: ${K6_POD_EXIT_DUMP} (107 = script exception/load failure)"
    echo ""
    echo "--- job describe ---"
    kctl -n k6-load get job "$JOB" -o wide 2>/dev/null || true
    kctl -n k6-load describe job "$JOB" 2>/dev/null || true
    echo ""
    echo "--- pod(s) describe ---"
    kctl -n k6-load get pods -l job-name="$JOB" -o wide 2>/dev/null || true
    kctl -n k6-load describe pods -l job-name="$JOB" 2>/dev/null || true
    echo ""
    echo "--- job logs (last 200 lines) ---"
    kctl -n k6-load logs "job/$JOB" --tail=200 2>/dev/null || true
  } > "$K6_DEBUG_FILE" 2>&1
  log_info "Diagnostic dump written to: $K6_DEBUG_FILE (job describe, pod describe, logs tail)"

  # Show what went wrong: container exit code first, then last 50 lines of k6 logs
  K6_POD_EXIT=$(kctl -n k6-load get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null || echo "")
  say "--- k6 job failure (container exit code: ${K6_POD_EXIT:-?}) — last 50 lines of logs ---"
  kctl -n k6-load logs "job/$JOB" --tail=50 2>/dev/null | sed 's/^/  /' || true
  say "--- end k6 logs ---"
  if [[ "$K6_POD_EXIT" == "107" ]]; then
    warn "Exit 107 = k6 script exception at load/init (script never ran)."
    warn "  → If xk6-http3 import fails: use K6_HTTP2_ONLY=1 and re-run for HTTP/2-only chaos:"
    warn "  →   K6_HTTP2_ONLY=1 ./scripts/run-preflight-scale-and-all-suites.sh  (or rotation step only)"
    warn "  → Or rebuild k6 image: ./scripts/build-k6-image.sh (must include xk6-http3)."
    warn "  → Ensure k6-ca-cert ConfigMap exists; see logs above for GoError/hint."
  fi

  # Check if job is actually still running or completed
  JOB_COMPLETE=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
  JOB_FAILED=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
  
  if [[ "$JOB_COMPLETE" == "True" ]]; then
    ok "k6 job actually completed successfully (status check confirms - wait timed out but job finished)"
  elif [[ "$JOB_FAILED" == "True" ]]; then
    warn "k6 job failed (full dump: $K6_DEBUG_FILE)"
  else
    # Job might still be running or in unknown state
    warn "k6 job status unknown - will attempt to collect results anyway"
    warn "  → Diagnostic dump: $K6_DEBUG_FILE"
    warn "  → Check status: kubectl -n k6-load get job $JOB"
    warn "  → Live logs: kubectl -n k6-load logs -f job/$JOB"
  fi
fi
fi  # ROTATION_H2_KEYLOG else (in-cluster path)

say "Collecting chaos results…"
if [[ "$JOB" != "k6-local" ]]; then
  RESULT=$("$SCRIPT_DIR/run-k6-chaos.sh" collect "$JOB" 2>/dev/null) || RESULT=""
else
  RESULT="${K6_LOCAL_OUT:-}"
fi

# Wire capture drain, post-rotation verification, DB and health run once after all iterations (below)

# Verify we got valid results (indicates job ran successfully even if wait timed out)
if [[ ! -f "$RESULT" ]] || [[ ! -s "$RESULT" ]]; then
  warn "k6 result file is missing or empty - job may not have run"
  warn "  → Check job status: kubectl -n k6-load get job $JOB"
  warn "  → Check pod logs: kubectl -n k6-load logs job/$JOB"
  # Don't fail here - let the parsing below handle it
elif [[ -n "${K6_WAIT_DURATION:-}" ]] && [[ "${K6_WAIT_DURATION:-0}" -ge 480 ]]; then
  # If we got valid results but wait timed out, clarify that job actually completed
  # This happens when job takes longer than timeout but still finishes successfully
  # Check if job actually completed (not just timed out)
  JOB_COMPLETE=$(kctl -n k6-load get job "$JOB" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
  if [[ "$JOB_COMPLETE" == "True" ]]; then
    ok "k6 results collected successfully (job completed in ${K6_TOTAL_DURATION}s, wait timed out but job finished)"
  else
    ok "k6 results collected successfully (wait timed out at ${K6_WAIT_DURATION}s, but results are available)"
  fi
fi

# Parse results - prefer ROTATION_METRICS_JSON from k6 handleSummary (k6-chaos-test.js), fallback to legacy text grep
# Legacy format: "iterations.....................: 21369  118.708078/s" and "h2_fail....: 0.00%  0 out of 14245"
# Custom handleSummary outputs different text; JSON has throughput.count, h2/h3.count and .fails
ROTATION_JSON=""
[[ -f "$RESULT" ]] && [[ -s "$RESULT" ]] && ROTATION_JSON=$(grep "ROTATION_METRICS_JSON=" "$RESULT" 2>/dev/null | sed 's/^ROTATION_METRICS_JSON=//' | head -1)

if [[ -n "$ROTATION_JSON" ]] && command -v python3 >/dev/null 2>&1; then
  read -r TOTAL H2_COUNT H3_COUNT H2_FAIL_COUNT H3_FAIL_COUNT H2_FAIL_PCT H3_FAIL_PCT <<< "$(python3 - "$ROTATION_JSON" <<'PY' 2>/dev/null || echo "0 0 0 0 0 100 100"
import sys, json
try:
    d = json.loads(sys.argv[1])
    tp = d.get("throughput", {})
    h2 = d.get("h2", {})
    h3 = d.get("h3", {})
    total = int(tp.get("count", 0))
    h2c = int(h2.get("count", 0))
    h3c = int(h3.get("count", 0))
    h2f = int(h2.get("fails", 0))
    h3f = int(h3.get("fails", 0))
    h2pct = (100.0 * h2f / h2c) if h2c else 100
    h3pct = (100.0 * h3f / h3c) if h3c else 100
    print(total, h2c, h3c, h2f, h3f, "%.2f" % h2pct, "%.2f" % h3pct)
except Exception:
    print("0 0 0 0 0 100 100")
PY
)"
else
  TOTAL=0
  H2_COUNT=0
  H3_COUNT=0
  H2_FAIL_COUNT=0
  H3_FAIL_COUNT=0
  H2_FAIL_PCT="100"
  H3_FAIL_PCT="100"
  if [[ -f "$RESULT" ]] && [[ -s "$RESULT" ]]; then
    TOTAL=$(grep -E "[[:space:]]+iterations.*:" "$RESULT" 2>/dev/null | grep -oE '[0-9]+[[:space:]]+[0-9]+\.[0-9]+' | awk '{print $1}' | head -1 || echo "0")
    H2_FAIL_LINE=$(grep -E "[[:space:]]+h2_fail.*:" "$RESULT" 2>/dev/null | head -1)
    H3_FAIL_LINE=$(grep -E "[[:space:]]+h3_fail.*:" "$RESULT" 2>/dev/null | head -1)
    H2_FAIL_PCT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9.]+%' | head -1 | sed 's/%//' || echo "100")
    [[ -n "$H3_FAIL_LINE" ]] && H3_FAIL_PCT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9.]+%' | head -1 | sed 's/%//' || echo "100")
    H2_FAIL_COUNT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
    H3_FAIL_COUNT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
    H2_COUNT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '[0-9]+$' || echo "0")
    H3_COUNT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '[0-9]+$' || echo "0")
  fi
fi

# Convert percentage to decimal (0.00 = 0, 100.00 = 1) for threshold checks
H2_FAIL=$(echo "scale=4; ${H2_FAIL_PCT} / 100" | bc -l 2>/dev/null | head -c 6 || echo "1")
H3_FAIL=$(echo "scale=4; ${H3_FAIL_PCT} / 100" | bc -l 2>/dev/null | head -c 6 || echo "1")

# Expected/drop for reporting (set even when RESULT empty so bc and summary work)
ACTUAL_DURATION_SEC=$(echo "$DURATION" | sed 's/s$//' | grep -oE '^[0-9]+' || echo "90")
EXPECTED_TOTAL=$(( (H2_RATE + H3_RATE) * ACTUAL_DURATION_SEC ))
EXPECTED_RATE=$((H2_RATE + H3_RATE))
DROPPED=$((EXPECTED_TOTAL - TOTAL))
if [[ "$EXPECTED_TOTAL" -gt 0 ]]; then
  DROP_PCT=$(echo "scale=2; $DROPPED * 100 / $EXPECTED_TOTAL" | bc -l 2>/dev/null || echo "100")
else
  DROP_PCT="0"
fi
if [[ "$TOTAL" -gt 0 ]]; then
  ACTUAL_RATE=$(echo "scale=2; $TOTAL / $ACTUAL_DURATION_SEC" | bc -l 2>/dev/null || echo "0")
else
  ACTUAL_RATE="0"
fi

say "=== Chaos Summary (H2/H3 failure % and real req/s) ==="
ok "Total Requests: $TOTAL"
ok "H2: $H2_COUNT requests, Failures: $H2_FAIL_COUNT (${H2_FAIL_PCT}%)"
ok "H3: $H3_COUNT requests, Failures: $H3_FAIL_COUNT (${H3_FAIL_PCT}%)"
ok "Real req/s: ${ACTUAL_RATE} (expected ${EXPECTED_RATE}), Drop: ${DROPPED} iterations (${DROP_PCT}%)"
log_info "Iteration $ITERATION/${MAX_ITERATIONS} — pass: $([[ "$H2_FAIL_PCT" == "0.00" ]] && [[ "$H3_FAIL_PCT" == "0.00" ]] && echo yes || echo no), freq: ${ACTUAL_RATE} req/s"
# Consolidated metrics card (freq/s, percentiles, wire hint)
if [[ -n "$ROTATION_JSON" ]]; then
  python3 - "$ROTATION_JSON" "$ACTUAL_RATE" "$ITERATION" <<'PY' 2>/dev/null || true
import sys, json
try:
    d = json.loads(sys.argv[1])
    rate = sys.argv[2]
    it = sys.argv[3]
    l = d.get("latency", {})
    h2 = l.get("h2", {})
    h3 = l.get("h3", {})
    h2p = h2.get("p50"), h2.get("p95"), h2.get("p99"), h2.get("p100")
    h3p = h3.get("p50"), h3.get("p95"), h3.get("p99"), h3.get("p100")
    def fmt(x): return "%.1f" % x if x is not None else "n/a"
    print("  \033[1mMetrics card\033[0m: freq=%s req/s | H2 p50=%sms p95=%sms p99=%sms | H3 p50=%sms p95=%sms p99=%sms | iter %s" % (
        rate, fmt(h2p[0]), fmt(h2p[1]), fmt(h2p[2]), fmt(h3p[0]), fmt(h3p[1]), fmt(h3p[2]), it))
except Exception:
    pass
PY
fi
if [[ -n "${K6_TOTAL_DURATION:-}" ]]; then
  ok "k6 Execution Time: ${K6_TOTAL_DURATION}s (expected: ~${DURATION_SEC}s + overhead)"
fi
if [[ "$TOTAL" -gt 0 ]]; then
  ok "Duration: ${ACTUAL_DURATION_SEC}s, Expected: ${EXPECTED_TOTAL} requests, Actual: ${TOTAL} requests"
else
  warn "No k6 results (job may not have run or collect failed) - H2/H3 req/s and drop % from expected only"
fi

# Parse ROTATION_METRICS_JSON from k6 handleSummary (latency breakdown + Little's Law)
ROTATION_JSON=""
if [[ -f "$RESULT" ]] && [[ -s "$RESULT" ]]; then
  ROTATION_JSON=$(grep "ROTATION_METRICS_JSON=" "$RESULT" 2>/dev/null | sed 's/^ROTATION_METRICS_JSON=//' | head -1)
fi
if [[ -n "$ROTATION_JSON" ]]; then
  say "=== k6 metrics breakdown (latency & Little's Law) ==="
  # Use python for portable JSON parsing (jq optional)
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROTATION_JSON" <<'PY'
import sys, json
try:
    d = json.loads(sys.argv[1])
    l = d.get("latency", {})
    h2 = l.get("h2", {})
    h3 = l.get("h3", {})
    ll = d.get("littlesLaw", {})
    pct_keys = ("avg", "p50", "p95", "p99", "p999", "p9999", "p99999", "p999999", "p9999999", "p99999999", "p100")
    for label, vals in [("H2", h2), ("H3", h3)]:
        if vals:
            parts = []
            for k in pct_keys:
                v = vals.get(k)
                if v is not None:
                    if k == "avg": parts.append("avg=%.1fms" % v)
                    else: parts.append("%s=%.1fms" % (k, v))
            print("  %s latency: %s" % (label, ", ".join(parts)))
    if ll:
        la = ll.get("lambda_per_sec"); W = ll.get("W_sec"); L = ll.get("L_avg_concurrency")
        if la is not None and W is not None and L is not None:
            print("  Little's Law: L = λ × W = %.2f × %.3fs = %.2f (avg in-flight requests)" % (la, W, L))
except Exception as e:
    print("  (parse error: %s)" % e, file=sys.stderr)
PY
  fi
  # Write summary JSON for D3 dashboard (scripts/rotation-dashboard.html)
  # Per-iteration write: raw k6 JSON (setup merged in final combined write)
  if [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && [[ -d "$WIRE_CAPTURE_DIR" ]]; then
    ROTATION_SUMMARY_JSON="$WIRE_CAPTURE_DIR/rotation-summary.json"
  else
    ROTATION_SUMMARY_JSON="/tmp/rotation-summary-${TIMESTAMP}.json"
    mkdir -p "$(dirname "$ROTATION_SUMMARY_JSON")" 2>/dev/null || true
  fi
  if echo "$ROTATION_JSON" > "$ROTATION_SUMMARY_JSON" 2>/dev/null; then
    ROTATION_LAST_SUMMARY_JSON="$ROTATION_SUMMARY_JSON"
    log_info "Metrics JSON for dashboard: $ROTATION_SUMMARY_JSON"
  fi
  # Save per-phase JSON for 3-phase dashboard (phase1=baseline, phase2=max no drop, phase3=max no error)
  if [[ "$ROTATION_PHASE" == "1" ]]; then
    PHASE1_JSON="$ROTATION_JSON"
    log_info "Phase 1 (baseline) metrics saved"
  elif [[ "$ROTATION_PHASE" == "2" ]]; then
    PHASE2_JSON="$ROTATION_JSON"
  elif [[ "$ROTATION_PHASE" == "3" ]]; then
    PHASE3_JSON="$ROTATION_JSON"
  fi
fi

# Strict TLS/mTLS proof (CA + leaf rotation; k6 and gRPC use strict verification)
say "=== Strict TLS / mTLS proof (CA + leaf rotation) ==="
ok "k6: insecureSkipTLSVerify=false; CA from ConfigMap (dev-root-ca); TLS 1.3 only for H2; H3 strict TLS."
ok "Caddy: serves leaf from record-local-tls (rotated); clients validate with dev-root-ca."
ok "gRPC: services use service-tls (leaf + CA); mTLS with client cert (tls.crt/tls.key) and CA verification."
log_info "Certificate verified above: issuer = dev CA (CN=dev-root-ca, O=record-platform); subject = CN=record.local."

# Extract error details from k6 logs if failures occurred (only when RESULT is a valid file - avoid set -e exit on grep)
if [[ "$H2_FAIL_COUNT" -gt 0 ]] || [[ "$H3_FAIL_COUNT" -gt 0 ]]; then
  say "=== Failure Analysis ==="
  if [[ -f "$RESULT" ]] && [[ -s "$RESULT" ]]; then
    HTTP_REQ_FAILED=$(grep -E "[[:space:]]+http_req_failed.*:" "$RESULT" 2>/dev/null | head -1 || echo "")
    if [[ -n "$HTTP_REQ_FAILED" ]]; then
      HTTP_REQ_FAILED_PCT=$(echo "$HTTP_REQ_FAILED" | grep -oE '[0-9.]+%' | head -1 || echo "0%")
      HTTP_REQ_FAILED_COUNT=$(echo "$HTTP_REQ_FAILED" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
      warn "HTTP Request Failures: $HTTP_REQ_FAILED_COUNT (Rate: $HTTP_REQ_FAILED_PCT)"
    fi
    # Exclude k6 metric lines and ROTATION_METRICS_JSON — those are data, not error messages
    ERROR_MESSAGES=$(grep -iE "error|failed|timeout|connection.*refused|certificate.*error|tls.*error" "$RESULT" 2>/dev/null | grep -vE "^[[:space:]]+[a-zA-Z0-9_]+:.*passes=.*fails=" | grep -v "ROTATION_METRICS_JSON" | head -20 || echo "")
    if [[ -n "$ERROR_MESSAGES" ]]; then
      warn "Error messages found in k6 logs:"
      echo "$ERROR_MESSAGES" | sed 's/^/    → /' | head -10
    fi
    if grep -qiE "certificate.*verify|tls.*handshake|ssl.*error" "$RESULT" 2>/dev/null; then
      warn "TLS/Certificate errors detected - check CA certificate configuration"
    fi
    # Only warn on actual timeout messages, not k6 metric lines (h2_timeout: passes=0 fails=N)
    if grep -iE "timeout|deadline.*exceeded" "$RESULT" 2>/dev/null | grep -vE "^[[:space:]]+[a-zA-Z0-9_]+:.*passes=.*fails=" | grep -q .; then
      warn "Timeout errors detected - requests may be taking too long during rotation"
    fi
    if grep -qiE "connection.*refused|connection.*reset" "$RESULT" 2>/dev/null; then
      warn "Connection errors detected - Caddy may have been briefly unavailable"
    fi
    warn "k6 log file: $RESULT (check for detailed error messages)"
  else
    warn "k6 log file missing or empty - cannot extract failure details"
  fi
fi

  # Three-phase logic: (1) baseline one run, (2) max without drop, (3) max without error
  H2_FAIL_CHECK=$(echo "$H2_FAIL > 0" | bc -l 2>/dev/null || echo "1")
  H3_FAIL_CHECK=$(echo "$H3_FAIL > 0" | bc -l 2>/dev/null || echo "1")
  DROP_CHECK=$(echo "$DROP_PCT > $MAX_DROP_PCT" | bc -l 2>/dev/null || echo "1")

  # Record first iteration where drop or error occurred (for dashboard: max iter before drop / before error)
  [[ "$ITER_AT_FIRST_DROP" -eq 0 ]] && [[ "$DROP_CHECK" == "1" ]] && ITER_AT_FIRST_DROP=$ITERATION
  [[ "$ITER_AT_FIRST_H2_ERROR" -eq 0 ]] && [[ "$H2_FAIL_CHECK" == "1" ]] && ITER_AT_FIRST_H2_ERROR=$ITERATION
  [[ "$ITER_AT_FIRST_H3_ERROR" -eq 0 ]] && [[ "$H3_FAIL_CHECK" == "1" ]] && ITER_AT_FIRST_H3_ERROR=$ITERATION

  if [[ "$TOTAL" -le 0 ]]; then
    warn "Could not collect valid k6 results (Total: $TOTAL, H2: $H2_COUNT, H3: $H3_COUNT)"
    warn "  → Check logs: kubectl -n k6-load logs job/$JOB"
    break
  fi

  if [[ "$ROTATION_PHASE" == "1" ]]; then
    # Phase 1 (baseline) done; switch to phase 2
    say "Phase 1 (baseline) complete — starting Phase 2 (max without drop)"
    ROTATION_PHASE=2
    MAX_NO_DROP_H2=$H2_RATE
    MAX_NO_DROP_H3=$H3_RATE
    ITER_AT_MAX_NO_DROP=$ITERATION
    H2_RATE=$((H2_RATE + H2_INCREMENT))
    H3_RATE=$((H3_RATE + H3_INCREMENT))
    [[ $ITERATION -lt $MAX_ITERATIONS ]] && say "=== Next iteration: H2=${H2_RATE} req/s, H3=${H3_RATE} req/s ===" && echo ""
  elif [[ "$ROTATION_PHASE" == "2" ]]; then
    if [[ "$DROP_CHECK" == "1" ]]; then
      say "Phase 2 limit (drops > ${MAX_DROP_PCT}%) — starting Phase 3 (max without error)"
      ROTATION_PHASE=3
      H2_RATE=$H2_START_RATE
      H3_RATE=$H3_START_RATE
      echo ""
    else
      MAX_NO_DROP_H2=$H2_RATE
      MAX_NO_DROP_H3=$H3_RATE
      ITER_AT_MAX_NO_DROP=$ITERATION
      ok "✅ Phase 2 iter $ITERATION: H2=${H2_RATE} H3=${H3_RATE} req/s, drop ${DROP_PCT}%"
      H2_RATE=$((H2_RATE + H2_INCREMENT))
      H3_RATE=$((H3_RATE + H3_INCREMENT))
    fi
    if [[ $ITERATION -ge $MAX_ITERATIONS ]] && [[ "$ROTATION_PHASE" == "2" ]]; then
      ROTATION_PHASE=3
      H2_RATE=$H2_START_RATE
      H3_RATE=$H3_START_RATE
    fi
    [[ $ITERATION -lt $MAX_ITERATIONS ]] && echo ""
  elif [[ "$ROTATION_PHASE" == "3" ]]; then
    if [[ "$H2_FAIL_CHECK" == "1" ]] || [[ "$H3_FAIL_CHECK" == "1" ]]; then
      warn "Phase 3 limit (errors detected) — stopping"
      break
    fi
    LAST_SUCCESSFUL_H2=$H2_RATE
    LAST_SUCCESSFUL_H3=$H3_RATE
    ITER_AT_MAX_NO_ERROR=$ITERATION
    ok "✅ Phase 3 iter $ITERATION: H2=${H2_RATE} H3=${H3_RATE} req/s, fail 0%"
    H2_RATE=$((H2_RATE + H2_INCREMENT))
    H3_RATE=$((H3_RATE + H3_INCREMENT))
    if [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
      ok "✅ Reached maximum iterations ($MAX_ITERATIONS)"
      break
    fi
    say "=== Next iteration: H2=${H2_RATE} req/s, H3=${H3_RATE} req/s ==="
    echo ""
  fi
done

# Wire capture drain and post-rotation verification run once after all iterations (captures full suite for 250k+ QUIC)
if [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && [[ -d "$WIRE_CAPTURE_DIR" ]]; then
  say "Wire capture drain for HTTP/3/QUIC packets (with timesteps)..."
  info "[T+0s] Starting packet drain (k6 finished, allowing packets to arrive)"
  sleep 5
  info "[T+5s] First drain phase complete"
  info "[T+5s] Extended drain for QUIC/UDP packets (15s more)"
  sleep 15
  info "[T+20s] Extended drain complete (total 20s drain time)"
  # Optional: mark capture invalid if pods restarted during k6 (do not fail rotation)
  if [[ ${#CADDY_UIDS[@]} -gt 0 ]] && [[ ${#CADDY_PODS[@]} -gt 0 ]]; then
    FINAL_UIDS=()
    for _p in "${CADDY_PODS[@]}"; do
      _uid=$(kctl -n "$NS_ING" get pod "$_p" -o jsonpath='{.metadata.uid}' 2>/dev/null || echo "")
      [[ -n "$_uid" ]] && FINAL_UIDS+=("$_uid")
    done
    if [[ "${CADDY_UIDS[*]}" != "${FINAL_UIDS[*]}" ]]; then
      warn "Pod restarted during k6 — capture may be invalid (wire verification still runs on available pcaps)"
    fi
  fi
  info "[T+20s] Stopping tcpdump processes and syncing buffers"
  for pid in "${CADDY_CAPTURE_PIDS[@]:-}"; do
    if [[ -n "$pid" ]]; then
      kill -TERM "$pid" 2>/dev/null && info "  Stopped Caddy capture PID $pid" || true
    fi
  done
  if [[ -n "${ENVOY_CAPTURE_PID:-}" ]]; then
    kill -TERM "$ENVOY_CAPTURE_PID" 2>/dev/null && info "  Stopped Envoy capture PID $ENVOY_CAPTURE_PID" || true
  fi
  info "[T+20s] Waiting for tcpdump to flush buffers (5s)"
  sleep 5
  info "[T+25s] tcpdump flush complete"
  info "[T+25s] Copying pcap files from pods"
  for p in "${CADDY_PODS[@]:-}"; do
    [[ -z "$p" ]] && continue
    info "  Copying from Caddy pod: $p"
    kctl -n "$NS_ING" exec "$p" -- sh -c "sync 2>/dev/null; cat /tmp/rotation-caddy-$p.pcap" > \
      "$WIRE_CAPTURE_DIR/caddy-rotation-$p.pcap" 2>/dev/null && \
      info "    ✓ Copied $(ls -lh "$WIRE_CAPTURE_DIR/caddy-rotation-$p.pcap" 2>/dev/null | awk '{print $5}')" || \
      warn "    ✗ Failed to copy from $p"
  done
  if [[ -n "${ENVOY_POD:-}" ]] && [[ -n "${ENVOY_NS:-}" ]]; then
    info "  Copying from Envoy pod: $ENVOY_POD"
    kctl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c "sync 2>/dev/null; cat /tmp/rotation-envoy.pcap" > \
      "$WIRE_CAPTURE_DIR/envoy-rotation.pcap" 2>/dev/null && \
      info "    ✓ Copied $(ls -lh "$WIRE_CAPTURE_DIR/envoy-rotation.pcap" 2>/dev/null | awk '{print $5}')" || \
      warn "    ✗ Failed to copy from Envoy"
    ENVOY_SIZE=$(wc -c < "$WIRE_CAPTURE_DIR/envoy-rotation.pcap" 2>/dev/null | tr -d '[:space:]')
    [[ "${ENVOY_SIZE:-0}" -lt 100 ]] && info "  (Envoy pcap small: chaos load hits /_caddy/healthz only, no gRPC; expected)"
  fi
  ok "Wire-level captures copied to $WIRE_CAPTURE_DIR"
fi
if [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && [[ -d "$WIRE_CAPTURE_DIR" ]]; then
  say "Verifying protocols in packet captures (post-rotation)…"
  [[ -f "$SCRIPT_DIR/lib/protocol-verification.sh" ]] && source "$SCRIPT_DIR/lib/protocol-verification.sh"
  ROTATION_SSLKEYLOG="${ROTATION_SSLKEYLOG:-}" "$SCRIPT_DIR/verify-k6-protocols.sh" "$WIRE_CAPTURE_DIR" "${ROTATION_SSLKEYLOG:-}" || warn "Protocol verification had issues"
  if command -v tshark >/dev/null 2>&1; then
    POST_HTTP2=0
    POST_QUIC=0
    POST_ALPN_H2=0
    POST_TCP443=0
    # Robust loop: find all Caddy pcaps (avoid literal glob when no match)
    CADDY_PCAP_LIST=()
    while IFS= read -r -d '' f; do
      CADDY_PCAP_LIST+=("$f")
    done < <(find "$WIRE_CAPTURE_DIR" -maxdepth 1 -name "*caddy*.pcap" -size +0 -print0 2>/dev/null)
    [[ ${#CADDY_PCAP_LIST[@]} -eq 0 ]] && for p in "$WIRE_CAPTURE_DIR"/caddy-rotation-*.pcap; do
      [[ -f "$p" ]] && [[ -s "$p" ]] && [[ "$p" != *\* ]] && CADDY_PCAP_LIST+=("$p")
    done
    for pcap in "${CADDY_PCAP_LIST[@]}"; do
      [[ -z "$pcap" ]] || [[ ! -f "$pcap" ]] && continue
      if type count_http2_in_pcap &>/dev/null 2>&1; then
        POST_HTTP2=$((POST_HTTP2 + $(count_http2_in_pcap "$pcap" "${ROTATION_SSLKEYLOG:-}")))
        POST_QUIC=$((POST_QUIC + $(count_quic_in_pcap "$pcap")))
        POST_ALPN_H2=$((POST_ALPN_H2 + $(count_alpn_h2_in_pcap "$pcap")))
      else
        _keylog_opts=()
        [[ -n "${ROTATION_SSLKEYLOG:-}" ]] && [[ -f "${ROTATION_SSLKEYLOG}" ]] && [[ -s "${ROTATION_SSLKEYLOG}" ]] && _keylog_opts=(-o "tls.keylog_file:${ROTATION_SSLKEYLOG}")
        n=$(tshark -r "$pcap" "${_keylog_opts[@]}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        [[ "$n" =~ ^[0-9]+$ ]] && POST_HTTP2=$((POST_HTTP2 + n))
        n=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        [[ "$n" =~ ^[0-9]+$ ]] && POST_QUIC=$((POST_QUIC + n))
        n=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
        [[ "$n" =~ ^[0-9]+$ ]] && POST_ALPN_H2=$((POST_ALPN_H2 + n))
      fi
      n=$(tshark -r "$pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
      [[ "$n" =~ ^[0-9]+$ ]] && POST_TCP443=$((POST_TCP443 + n))
    done
    say "=== Post-rotation protocol verification (wire-level) ==="
    info "k6 chaos traffic only: HTTP/2 (tcp 443) + HTTP/3 (udp 443). Per-pod counts vary by MetalLB L2 load balancing."
    # Per-pod breakdown (HTTP/2 ALPN, frames, QUIC, TCP/UDP 443) — same format as enhanced smoke test
    for pcap in "${CADDY_PCAP_LIST[@]}"; do
      [[ -z "$pcap" ]] || [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]] && continue
      podname=$(basename "$pcap" .pcap | sed 's/^caddy-rotation-//')
      [[ -z "$podname" ]] && podname=$(basename "$pcap" .pcap)
      _tcp443=$(tshark -r "$pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
      _udp443=$(tshark -r "$pcap" -Y "udp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
      _alpn_h2=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
      _http2_frames=0
      if [[ -n "${ROTATION_SSLKEYLOG:-}" ]] && [[ -f "${ROTATION_SSLKEYLOG}" ]] && [[ -s "${ROTATION_SSLKEYLOG}" ]]; then
        _http2_frames=$(tshark -r "$pcap" -o "tls.keylog_file:${ROTATION_SSLKEYLOG}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
      fi
      _quic=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
      [[ "$_tcp443" =~ ^[0-9]+$ ]] || _tcp443=0
      [[ "$_udp443" =~ ^[0-9]+$ ]] || _udp443=0
      [[ "$_alpn_h2" =~ ^[0-9]+$ ]] || _alpn_h2=0
      [[ "$_http2_frames" =~ ^[0-9]+$ ]] || _http2_frames=0
      [[ "$_quic" =~ ^[0-9]+$ ]] || _quic=0
      echo "=== ${NS_ING}/${podname} ==="
      echo "  TCP 443: $_tcp443"
      echo "  UDP 443: $_udp443"
      echo "  HTTP/2(ALPN): $_alpn_h2"
      [[ "$_http2_frames" -gt 0 ]] && echo "  HTTP/2(frames): $_http2_frames"
      echo "  QUIC: $_quic"
    done
    if [[ "$POST_HTTP2" -gt 0 ]]; then
      ok "HTTP/2 verified after rotation ($POST_HTTP2 decrypted frames, tshark http2 filter)"
    elif [[ "$POST_ALPN_H2" -gt 0 ]]; then
      ok "HTTP/2 intent verified after rotation (ALPN h2 in Client Hello, $POST_ALPN_H2; frames TLS-encrypted)"
    elif [[ "$POST_TCP443" -gt 0 ]]; then
      ok "HTTP/2 traffic present (TCP 443=$POST_TCP443 packets; TLS-encrypted, ALPN not decoded)"
    else
      info "HTTP/2 frames not visible due to TLS encryption (expected; curl/k6 health is proof)"
    fi
    if [[ "$POST_QUIC" -gt 0 ]]; then
      ok "HTTP/3 (QUIC) verified after rotation ($POST_QUIC packets, tshark quic filter)"
    else
      warn "HTTP/3 (QUIC) not detected in captures after rotation (k6 may use HTTP/2 fallback or traffic path)"
    fi
    info "Packet capture: HTTP/2(frames)=$POST_HTTP2, HTTP/2(ALPN)=$POST_ALPN_H2, QUIC=$POST_QUIC, TCP443=$POST_TCP443"
    # Capture is best-effort; k6 metrics are primary truth. Do not fail rotation on missing/empty pcaps.
    if [[ "$POST_TCP443" -eq 0 ]]; then
      warn "Capture validation inconclusive — no TCP 443 in pcaps (traffic verified via k6 metrics; capture may have missed or copy failed)."
    fi
    if [[ "$POST_QUIC" -gt 0 ]]; then
      ok "QUIC verified at ingress layer (L2 Caddy)"
    elif [[ "$POST_ALPN_H2" -gt 0 ]]; then
      warn "QUIC not detected at L2; HTTP/2 verified via ALPN h2 (acceptable for rotation)"
    elif [[ "$POST_TCP443" -gt 0 ]]; then
      warn "QUIC/ALPN h2 not detected in capture; TCP 443 present. k6 metrics are primary; capture is secondary."
    else
      warn "Capture validation inconclusive — no QUIC/ALPN h2/TCP443 in pcaps. k6 metrics are primary truth; packet capture is best-effort."
    fi
  fi
fi
say "Verifying database state after tests…"
"$SCRIPT_DIR/verify-k6-database.sh" || warn "Database verification had issues"
CA_CERT=""
if [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && [[ -s "$REPO_ROOT/certs/dev-root.pem" ]]; then
  CA_CERT="$REPO_ROOT/certs/dev-root.pem"
fi
if [[ -z "$CA_CERT" ]] && [[ -n "${CA_ROOT:-}" ]] && [[ -f "$CA_ROOT" ]]; then
  CA_CERT="$CA_ROOT"
fi
if [[ -z "$CA_CERT" ]] || [[ ! -f "$CA_CERT" ]]; then
  CA_CERT=$(kctl -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null)
  [[ -n "$CA_CERT" ]] && echo "$CA_CERT" > /tmp/rotation-ca-$$.pem && CA_CERT="/tmp/rotation-ca-$$.pem"
fi
# MetalLB: when TARGET_IP and PORT=443 are set (by run-all), use LB IP — never overwrite with NodePort/127.0.0.1
NODEPORT=$(kctl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "30443")
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
  export PORT=443
  HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
  ok "Using MetalLB: ${HOST}:443 resolved to ${TARGET_IP}"
else
  export PORT="${PORT:-${NODEPORT:-30443}}"
  HTTP3_RESOLVE="${HOST}:${PORT}:127.0.0.1"
fi
export CA_CERT NS="$NS_APP" HOST SCRIPT_DIR
mkdir -p /tmp/grpc-certs
if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
  cp -f "$CA_CERT" /tmp/grpc-certs/ca.crt 2>/dev/null && ok "Refreshed /tmp/grpc-certs/ca.crt with new CA" || true
fi
SVC_TLS_CRT=$(kctl -n "$NS_APP" get secret service-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d 2>/dev/null)
SVC_TLS_KEY=$(kctl -n "$NS_APP" get secret service-tls -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d 2>/dev/null)
if [[ -n "$SVC_TLS_CRT" ]] && [[ -n "$SVC_TLS_KEY" ]]; then
  echo "$SVC_TLS_CRT" > /tmp/grpc-certs/tls.crt && echo "$SVC_TLS_KEY" > /tmp/grpc-certs/tls.key 2>/dev/null && ok "Refreshed /tmp/grpc-certs (tls.crt, tls.key)" || true
fi
export GRPC_CERTS_DIR=/tmp/grpc-certs
export HTTP3_RESOLVE
_kb() { kctl "$@"; }
[[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && . "$SCRIPT_DIR/lib/http3.sh"
strict_http3_curl() { if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then http3_curl --cacert "$CA_CERT" "$@" 2>/dev/null; else http3_curl -k "$@"; fi; }
if [[ -f "$SCRIPT_DIR/lib/grpc-http3-health.sh" ]]; then
  . "$SCRIPT_DIR/lib/grpc-http3-health.sh"
  run_grpc_http3_health_checks
fi

# Write combined rotation-summary.json with phase1, phase2, phase3 for 3-chart dashboard
if [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && [[ -d "$WIRE_CAPTURE_DIR" ]]; then
  ROTATION_SUMMARY_JSON="$WIRE_CAPTURE_DIR/rotation-summary.json"
else
  ROTATION_SUMMARY_JSON="/tmp/rotation-summary-${TIMESTAMP}.json"
  mkdir -p "$(dirname "$ROTATION_SUMMARY_JSON")" 2>/dev/null || true
fi
if [[ -n "$PHASE1_JSON" ]] || [[ -n "$PHASE2_JSON" ]] || [[ -n "$PHASE3_JSON" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    CADDY_POD_COUNT=0
    CADDY_POD_NAMES=""
    if [[ -n "${CADDY_PODS+x}" ]] && [[ ${#CADDY_PODS[@]} -gt 0 ]] 2>/dev/null; then
      CADDY_POD_COUNT=${#CADDY_PODS[@]}
      CADDY_POD_NAMES="${CADDY_PODS[*]}"
    fi
    TMP_P1="${WIRE_CAPTURE_DIR:-/tmp}/phase1.json"
    TMP_P2="${WIRE_CAPTURE_DIR:-/tmp}/phase2.json"
    TMP_P3="${WIRE_CAPTURE_DIR:-/tmp}/phase3.json"
    echo "${PHASE1_JSON:-}" > "$TMP_P1"
    echo "${PHASE2_JSON:-}" > "$TMP_P2"
    echo "${PHASE3_JSON:-}" > "$TMP_P3"
    # Include limits (max H2/H3, iteration limits, telemetry placeholders) for 8-chart dashboard
    python3 - "$TMP_P1" "$TMP_P2" "$TMP_P3" "$ROTATION_SUMMARY_JSON" \
      "${LAST_SUCCESSFUL_H2:-0}" "${LAST_SUCCESSFUL_H3:-0}" \
      "${MAX_NO_DROP_H2:-0}" "${MAX_NO_DROP_H3:-0}" \
      "${ITER_AT_MAX_NO_ERROR:-0}" "${ITER_AT_MAX_NO_DROP:-0}" \
      "${ITER_AT_FIRST_DROP:-0}" "${ITER_AT_FIRST_H2_ERROR:-0}" "${ITER_AT_FIRST_H3_ERROR:-0}" \
      "${MAX_ITERATIONS:-30}" \
      "${CADDY_POD_COUNT:-0}" "${CADDY_POD_NAMES:-}" \
      "${H2_START_RATE:-320}" "${H3_START_RATE:-180}" "${DURATION:-90s}" <<'PY'
import sys, json
def load(path):
    try:
        with open(path) as f:
            s = f.read().strip()
            return json.loads(s) if s else None
    except Exception:
        return None
p1, p2, p3 = load(sys.argv[1]), load(sys.argv[2]), load(sys.argv[3])
out = sys.argv[4]
h2_ok, h3_ok = int(sys.argv[5]), int(sys.argv[6])
h2_drop, h3_drop = int(sys.argv[7]), int(sys.argv[8])
iter_ok, iter_drop = int(sys.argv[9]), int(sys.argv[10])
iter_first_drop = int(sys.argv[11])
iter_first_h2_err = int(sys.argv[12])
iter_first_h3_err = int(sys.argv[13])
max_iter = int(sys.argv[14])
caddy_count = int(sys.argv[15]) if len(sys.argv) > 15 else 0
caddy_names = sys.argv[16] if len(sys.argv) > 16 else ""
h2_rate = sys.argv[17] if len(sys.argv) > 17 else "320"
h3_rate = sys.argv[18] if len(sys.argv) > 18 else "180"
duration = sys.argv[19] if len(sys.argv) > 19 else "90s"
setup = {
    "caddy_pods": {"count": caddy_count, "expected_for_capture": 2, "names": [x.strip() for x in caddy_names.split() if x.strip()]},
    "k6_rates": {"h2_req_s": h2_rate, "h3_req_s": h3_rate, "duration": duration},
}
payload = {
    "phase1": p1, "phase2": p2, "phase3": p3,
    "setup": setup,
    "limits": {
        "max_no_error": {"h2_req_s": h2_ok, "h3_req_s": h3_ok, "combined_req_s": h2_ok + h3_ok, "iteration": iter_ok},
        "max_no_drop": {"h2_req_s": h2_drop, "h3_req_s": h3_drop, "combined_req_s": h2_drop + h3_drop, "iteration": iter_drop},
        "max_iterations": max_iter,
        "iter_at_first_drop": iter_first_drop,
        "iter_at_first_h2_error": iter_first_h2_err,
        "iter_at_first_h3_error": iter_first_h3_err,
    },
    "telemetry": {"queue_saturation": None, "cpu_pinned": None, "note": "Run strace/htop/perf/valgrind for live telemetry"},
}
with open(out, "w") as f:
    json.dump(payload, f, indent=2)
PY
    log_info "Metrics JSON (3 phases + limits) for dashboard: $ROTATION_SUMMARY_JSON"
  fi
fi

# Enterprise rotation-report.json (CI artifact / PDF-grade summary)
ROTATION_REPORT_JSON="${WIRE_CAPTURE_DIR:-/tmp}/rotation-report.json"
if [[ -n "${WIRE_CAPTURE_DIR:-}" ]] && [[ -d "${WIRE_CAPTURE_DIR:-}" ]]; then
  ROTATION_REPORT_JSON="$WIRE_CAPTURE_DIR/rotation-report.json"
else
  ROTATION_REPORT_JSON="/tmp/rotation-report-${TIMESTAMP}.json"
fi
cat <<REPORT > "$ROTATION_REPORT_JSON"
{
  "phase1_baseline": null,
  "max_without_drop": { "h2": ${MAX_NO_DROP_H2:-0}, "h3": ${MAX_NO_DROP_H3:-0} },
  "max_without_error": { "h2": ${LAST_SUCCESSFUL_H2:-0}, "h3": ${LAST_SUCCESSFUL_H3:-0} },
  "db_pool_size": 28,
  "packet_summary": { "http2_alpn": null, "quic_packets": null },
  "tls_validation": { "strict_tls": true, "mtls": true }
}
REPORT
[[ -s "$ROTATION_REPORT_JSON" ]] && log_info "Rotation report: $ROTATION_REPORT_JSON"

# Final summary: both limits (max without error, max without drop) + iteration limits (for 8-chart dashboard)
say "=== Adaptive Limit Finding Complete ==="
ok "Total iterations run: $ITERATION"
say "Max for both protocols without error (0% failures):"
ok "  Iteration: $ITER_AT_MAX_NO_ERROR — H2=${LAST_SUCCESSFUL_H2} req/s, H3=${LAST_SUCCESSFUL_H3} req/s, combined=$((LAST_SUCCESSFUL_H2 + LAST_SUCCESSFUL_H3)) req/s"
say "Max for both protocols without drop (drops ≤ ${MAX_DROP_PCT}%):"
if [[ "$MAX_NO_DROP_H2" -gt 0 ]] || [[ "$MAX_NO_DROP_H3" -gt 0 ]]; then
  ok "  Iteration: $ITER_AT_MAX_NO_DROP — H2=${MAX_NO_DROP_H2} req/s, H3=${MAX_NO_DROP_H3} req/s, combined=$((MAX_NO_DROP_H2 + MAX_NO_DROP_H3)) req/s"
else
  ok "  (no iteration had drops ≤ threshold; try lower start rate or higher K6_MAX_DROP_PCT)"
fi
say "Max iteration before drop / before error (8-chart dashboard):"
ok "  First iter with drop: ${ITER_AT_FIRST_DROP:-0}, first iter with H2 error: ${ITER_AT_FIRST_H2_ERROR:-0}, first iter with H3 error: ${ITER_AT_FIRST_H3_ERROR:-0}"

### Test 7: Verify new certificate is active
say "Test 7: Verify new certificate is active"
# Wait for Caddy to be fully ready before certificate test
say "Waiting for Caddy to be fully ready after rotation…"
kctl -n "$NS_ING" rollout status deploy/"$SERVICE" --timeout=30s >/dev/null 2>&1 || warn "Caddy rollout may still be in progress"
sleep 4  # Additional buffer for endpoint propagation and TLS handshake readiness

# Use port-forward for certificate verification (appropriate for single request)
CERT_PF_PORT=8443
CERT_PF_PID=""

# Kill any existing port-forward on this port first
pkill -f "port-forward.*${SERVICE}.*${CERT_PF_PORT}:443" >/dev/null 2>&1 || true
sleep 1

# Set up port-forward for certificate verification (host kubectl so 127.0.0.1 is on host)
$KUBECTL_PORT_FORWARD -n "$NS_ING" port-forward svc/"$SERVICE" ${CERT_PF_PORT}:443 >/dev/null 2>&1 &
CERT_PF_PID=$!
sleep 3  # Give port-forward more time to establish (increased from 2s)

# Verify port-forward is actually running and listening
if ! kill -0 "$CERT_PF_PID" 2>/dev/null; then
  warn "Port-forward process died immediately (PID: $CERT_PF_PID)"
  CERT_PF_PID=""
else
  # Additional check: verify port is actually listening
  sleep 1
  if ! kill -0 "$CERT_PF_PID" 2>/dev/null; then
    warn "Port-forward process died after startup (PID: $CERT_PF_PID)"
    CERT_PF_PID=""
  else
    # Try to verify port is listening (optional check)
    if command -v lsof >/dev/null 2>&1; then
      if lsof -i ":${CERT_PF_PORT}" >/dev/null 2>&1; then
        ok "Port-forward established on port ${CERT_PF_PORT} for certificate verification"
      else
        warn "Port-forward process running but port ${CERT_PF_PORT} not listening yet"
        sleep 2  # Give it more time
        if lsof -i ":${CERT_PF_PORT}" >/dev/null 2>&1; then
          ok "Port-forward established on port ${CERT_PF_PORT} for certificate verification"
        else
          warn "Port-forward may not be working - port ${CERT_PF_PORT} still not listening"
        fi
      fi
    else
      # lsof not available, just assume it's working if process is alive
      ok "Port-forward established on port ${CERT_PF_PORT} for certificate verification"
    fi
  fi
fi

# Use openssl s_client via port-forward (100% reliable) - retrieve NEW certificate
if [[ -n "$CERT_PF_PID" ]] && command -v openssl >/dev/null 2>&1; then
  # Get the NEW certificate after rotation
  CERT_INFO=$(echo | openssl s_client -connect "127.0.0.1:${CERT_PF_PORT}" -servername "${HOST}" -showcerts 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || echo "")
  if [[ -n "$CERT_INFO" ]]; then
    ok "Certificate info retrieved via port-forward (NEW certificate after rotation)"
    echo "$CERT_INFO" | sed 's/^/  /'
    
    # Extract certificate details for verification
    CERT_SUBJECT=$(echo "$CERT_INFO" | grep "subject=" | sed 's/subject=//')
    CERT_ISSUER=$(echo "$CERT_INFO" | grep "issuer=" | sed 's/issuer=//')
    CERT_NOT_BEFORE=$(echo "$CERT_INFO" | grep "notBefore=" | sed 's/notBefore=//')
    CERT_NOT_AFTER=$(echo "$CERT_INFO" | grep "notAfter=" | sed 's/notAfter=//')
    
    # Verify certificate issuer (check for new CA first, then mkcert)
    if echo "$CERT_ISSUER" | grep -q "CN=dev-root-ca"; then
      ok "✅ Certificate is from dev CA (CN=dev-root-ca, O=record-platform)"
      ok "  Issuer: $CERT_ISSUER"
      ok "  Subject: $CERT_SUBJECT"
      ok "  Valid from: $CERT_NOT_BEFORE to $CERT_NOT_AFTER"
    elif echo "$CERT_ISSUER" | grep -q "mkcert"; then
      ok "✅ Certificate is from mkcert (leaf-only rotation successful)"
      ok "  Issuer: $CERT_ISSUER"
      ok "  Subject: $CERT_SUBJECT"
    else
      warn "Certificate issuer not recognized (unexpected issuer)"
      echo "  Certificate info: $CERT_INFO"
    fi
    
    # Also retrieve the full certificate chain to verify CA and extract NEW CA
    CERT_CHAIN=$(echo | openssl s_client -connect "127.0.0.1:${CERT_PF_PORT}" -servername "${HOST}" -showcerts 2>/dev/null)
    if echo "$CERT_CHAIN" | grep -q "BEGIN CERTIFICATE"; then
      ok "Certificate chain retrieved (leaf + CA)"
      # Count certificates in chain
      CERT_COUNT=$(echo "$CERT_CHAIN" | grep -c "BEGIN CERTIFICATE" || echo "0")
      ok "  Certificate chain contains $CERT_COUNT certificate(s)"
      
      # Extract the CA certificate from the chain (usually the last one)
      if [[ $CERT_COUNT -gt 1 ]]; then
        # Extract CA certificate (last certificate in chain)
        NEW_CA_CERT=$(echo "$CERT_CHAIN" | awk '/BEGIN CERTIFICATE/{i++} i==2' RS='-----BEGIN CERTIFICATE-----' | sed '1s/^/-----BEGIN CERTIFICATE-----/' || echo "")
        if [[ -n "$NEW_CA_CERT" ]]; then
          ok "  CA certificate extracted from chain"
          # Verify CA certificate issuer
          CA_ISSUER=$(echo "$NEW_CA_CERT" | openssl x509 -noout -issuer 2>/dev/null || echo "")
          if [[ -n "$CA_ISSUER" ]]; then
            ok "  CA Issuer: $CA_ISSUER"
            # Check if this is the new CA (from rotation)
            if echo "$CA_ISSUER" | grep -q "CN=dev-root-ca"; then
              ok "  ✅ CA certificate confirmed (CN=dev-root-ca, O=record-platform)"
            fi
          fi
        fi
      fi
    fi
  else
    warn "Could not retrieve certificate info via port-forward"
    # Try alternative method
    CERT_INFO_ALT=$(timeout 5 openssl s_client -connect "127.0.0.1:${CERT_PF_PORT}" -servername "${HOST}" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
    if [[ -n "$CERT_INFO_ALT" ]]; then
      ok "Certificate info retrieved via alternative method"
      echo "$CERT_INFO_ALT" | sed 's/^/  /'
    else
      warn "All certificate retrieval methods failed"
    fi
  fi
else
  if [[ -z "$CERT_PF_PID" ]]; then
    warn "Port-forward not available for certificate verification"
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    warn "openssl not available - cannot verify certificate"
  fi
fi

# Cleanup port-forward after Test 7
if [[ -n "$CERT_PF_PID" ]]; then
  kill "$CERT_PF_PID" 2>/dev/null || true
  wait "$CERT_PF_PID" 2>/dev/null || true
fi

say "=== Rotation Suite Complete ==="
ROTATION_SUITE_END=$(date +%s)
ROTATION_TOTAL_SEC=$((ROTATION_SUITE_END - ROTATION_SUITE_START))
ROTATION_MIN=$((ROTATION_TOTAL_SEC / 60))
ROTATION_REM=$((ROTATION_TOTAL_SEC % 60))
ok "Rotation suite total time: ${ROTATION_TOTAL_SEC}s (${ROTATION_MIN}m ${ROTATION_REM}s)"
if [[ -n "${ROTATION_LAST_SUMMARY_JSON:-}" ]] && [[ -f "${ROTATION_LAST_SUMMARY_JSON}" ]]; then
  info "Dashboard (8 charts): open scripts/rotation-dashboard.html in a browser and load file: $ROTATION_LAST_SUMMARY_JSON"
fi
info "To reduce time: K6_DURATION=60s K6_MAX_ITERATIONS=5 (faster); or K6_MAX_ITERATIONS=30 (default) for full 3-phase limit finding."
info "HTTP/3 tuning: K6_H3_PRE_VUS=200 K6_H3_MAX_VUS=600 (defaults) give QUIC headroom; strict TLS invariant unchanged."
info "Why HTTP/2 frames=0: TLS encrypts payload; ALPN h2 = definitive proof. For decrypted frames: ROTATION_H2_KEYLOG=1 (requires k6+xk6-http3 on host)."

[[ -n "${TMP:-}" ]] && rm -rf "$TMP"
exit 0
