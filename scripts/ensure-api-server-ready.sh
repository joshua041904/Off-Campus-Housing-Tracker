#!/usr/bin/env bash
# Ensure Kubernetes API server is reachable before running kubectl/tests.
# Colima only (kind removed). Each attempt is capped at ATTEMPT_TIMEOUT so we don't hang on one try.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# When KUBECONFIG is unset, use Colima's so we don't rely on ~/.kube/config (can be broken after hygiene)
if [[ -z "${KUBECONFIG:-}" ]] && [[ -s "$HOME/.colima/default/kubernetes/kubeconfig" ]]; then
  export KUBECONFIG="$HOME/.colima/default/kubernetes/kubeconfig"
fi

MAX_ATTEMPTS="${API_SERVER_MAX_ATTEMPTS:-8}"
SLEEP="${API_SERVER_SLEEP:-1}"   # 1s between attempts = more efficient; rotation-suite can pass 2
CURRENT_CTX=$(kubectl config current-context 2>/dev/null || echo "")
# Cap total wait so we never hang. Colima can be slow (30–60s/attempt); 15 attempts may need ~8 min.
ENSURE_CAP="${ENSURE_CAP:-480}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# kubectl helper: Colima 127.0.0.1:6443, timeouts, colima-ssh fallback (kind removed)
if [[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]]; then
  # shellcheck source=scripts/lib/kubectl-helper.sh
  . "$SCRIPT_DIR/lib/kubectl-helper.sh"
  _kubectl() { kctl "$@"; }
else
  _kubectl() { kubectl "$@"; }
fi

# Per-attempt timeout: must allow _one_attempt to finish. kctl can run get nodes (10s) then fallback e.g. insecure (10s) = 20s. Use 25s so we never kill a healthy attempt.
ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-25}"

# Single check: get nodes only (strict TLS — no insecure-skip-tls-verify; fix kubeconfig so cert SAN matches).
_one_attempt() {
  if _kubectl get nodes >/dev/null 2>&1; then return 0; fi
  if [[ "$CURRENT_CTX" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl get nodes --request-timeout=15s >/dev/null 2>&1 && return 0
  fi
  return 1
}

# Show why the check failed: API server URL, reachability, TLS/SNI first (RCA), then kubectl. Appends RCA block to TELEMETRY_DURING.
_show_why_not_ready() {
  echo "  --- What's going on (API check failed; first failure only; we retry each attempt with fresh kubeconfig) ---"
  if [[ -n "${TELEMETRY_DURING:-}" ]] || [[ -n "${TELEMETRY_AFTER:-}" ]]; then
    echo "  Telemetry (preflight): inspect for API/metrics and RCA at failure time:"
    [[ -n "${TELEMETRY_DURING:-}" ]] && echo "    during-run: $TELEMETRY_DURING"
    [[ -n "${TELEMETRY_AFTER:-}" ]] && echo "    post-run:   $TELEMETRY_AFTER"
    [[ -n "${TELEMETRY_RAW_METRICS:-}" ]] && echo "    raw:        $TELEMETRY_RAW_METRICS"
  fi
  echo "  Context: $CURRENT_CTX"
  echo "  KUBECONFIG: ${KUBECONFIG:-<default>}"
  _server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  _port=""
  _host=""
  _tcp_127=0
  _tls_handshake=""
  _sans=""
  _insecure_ok=0
  _exit=1
  _strict_err=""
  if [[ -n "$_server" ]] && [[ "$_server" =~ ^https?://([^:/]+):([0-9]+) ]]; then
    _host="${BASH_REMATCH[1]}"
    _port="${BASH_REMATCH[2]}"
    echo "  API server URL: $_server"
    ( nc -z -w 3 127.0.0.1 "$_port" 2>/dev/null || nc -z -G 3 127.0.0.1 "$_port" 2>/dev/null ) && _tcp_127=1
    echo "  Reachability 127.0.0.1:$_port (TCP): $([ $_tcp_127 -eq 1 ] && echo "OK (port open)" || echo "failed")"
    if [[ $_tcp_127 -eq 1 ]]; then
      echo "  (TCP OK but kubectl failed → run TLS/SNI and API RCA below)"
    fi
  fi

  # --- TLS/SNI RCA first (root cause: is it TLS or API layer?) ---
  if [[ -n "$_port" ]] && command -v openssl >/dev/null 2>&1; then
    _connect_host="127.0.0.1"
    _openssl_stderr=$(mktemp 2>/dev/null || echo "/tmp/ensure-openssl-$$.err")
    _openssl_stdout=$(mktemp 2>/dev/null || echo "/tmp/ensure-openssl-$$.out")
    if echo "Q" | openssl s_client -connect "${_connect_host}:$_port" -servername "$_connect_host" 2>"$_openssl_stderr" | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null >"$_openssl_stdout"; then
      _tls_handshake="OK"
      _sans=$(grep -o 'subjectAltName[^,]*' "$_openssl_stdout" 2>/dev/null | sed 's/.*://;s/,/ /g' || echo "Q" | openssl s_client -connect "${_connect_host}:$_port" -servername "$_connect_host" 2>/dev/null | openssl x509 -noout -ext subjectAltName 2>/dev/null | sed 's/.*://;s/, / /g' || true)
      echo "  TLS/SNI (openssl s_client -servername $_connect_host): handshake OK"
      echo "  API server cert SANs: ${_sans:-<none>}"
      if echo "${_sans:-}" | grep -q "127.0.0.1"; then
        echo "  📌 127.0.0.1 is in cert → TLS is fine; failure is API layer (not ready, slow, or wrong path)."
      else
        echo "  📌 127.0.0.1 NOT in cert → TLS/SAN mismatch; recreate cluster with tls-san=127.0.0.1."
        _rca="TLS_cert_SAN_or_hostname_mismatch"
      fi
    else
      _tls_handshake="FAIL"
      _tls_err=$(cat "$_openssl_stderr" 2>/dev/null)
      echo "  TLS/SNI (openssl s_client -servername $_connect_host): handshake FAIL"
      # Root cause: API still starting (connection drops during handshake) — match OpenSSL error text reliably
      if echo "$_tls_err" | grep -q "connect:Connection refused"; then
        echo "    Reason: Connection refused (nothing accepting TLS on port — API not listening yet)."
        echo "  📌 Root cause: API not listening yet (port not open). Wait and retry; do NOT auto-restart (restart can change API port)."
        _rca="API_not_listening"
      elif echo "$_tls_err" | grep -qE "unexpected eof while reading|unexpected eof"; then
        echo "    Reason: TLS handshake aborted (unexpected eof) — API closed connection before handshake finished (API still starting)."
        echo "  📌 Root cause: API still starting. Wait and retry; do NOT auto-restart (restart can change API port and make things worse)."
        _rca="TLS_handshake_api_starting"
      elif echo "$_tls_err" | grep -qE "shutdown while in init|SSL_shutdown"; then
        echo "    Reason: TLS handshake aborted (shutdown while in init) — API closed connection during handshake (API still starting)."
        echo "  📌 Root cause: API still starting. Wait and retry; do NOT auto-restart (restart can change API port and make things worse)."
        _rca="TLS_handshake_api_starting"
      elif echo "$_tls_err" | grep -qE "certificate verify failed|handshake failure|alert "; then
        echo "    Reason: cert verify / handshake failure (first 5 lines):"
        echo "$_tls_err" | head -5 | sed 's/^/      /'
      else
        echo "    Reason (first 5 lines):"
        echo "$_tls_err" | head -5 | sed 's/^/      /'
        # Still detect API-starting from raw error text in case format varied
        if echo "$_tls_err" | grep -qE "unexpected eof|shutdown while in init|SSL_shutdown"; then
          echo "  📌 Root cause: API still starting (TLS aborted before completion). Wait and retry; do NOT auto-restart."
          _rca="TLS_handshake_api_starting"
        fi
      fi
      if [[ -z "${_rca:-}" ]]; then
        echo "  📌 TLS handshake failed → cert/SAN/SNI or nothing listening; fix cert or wait for API."
      fi
    fi
    rm -f "$_openssl_stderr" "$_openssl_stdout"
  fi

  # --- kubectl (strict then insecure) ---
  _out=$(mktemp 2>/dev/null || echo "/tmp/ensure-why-$$.out")
  kubectl get nodes --request-timeout=10s >"$_out" 2>&1; _exit=$?
  _strict_err=$(cat "$_out" 2>/dev/null)
  echo "  kubectl get nodes (strict TLS, exit=$_exit):"
  [[ -s "$_out" ]] && sed 's/^/    /' < "$_out" || echo "    (no output)"
  if [[ $_exit -ne 0 ]]; then
    if kubectl get nodes --request-timeout=10s --insecure-skip-tls-verify=true >/dev/null 2>&1; then
      _insecure_ok=1
      echo "  kubectl get nodes --insecure-skip-tls-verify=true: OK"
      echo "  📌 API responds when TLS skipped → root cause is TLS/certificate (SAN or hostname), not API down."
    else
      _ie_out=$(mktemp 2>/dev/null || echo "/tmp/ensure-insecure-$$.out")
      kubectl get nodes --request-timeout=10s --insecure-skip-tls-verify=true >"$_ie_out" 2>&1; _ie=$?
      echo "  kubectl get nodes --insecure-skip-tls-verify=true (exit=$_ie):"
      [[ -s "$_ie_out" ]] && sed 's/^/    /' < "$_ie_out" || echo "    (no output)"
      rm -f "$_ie_out"
      echo "  📌 API does not respond even with TLS skipped → API not ready, wrong port, or connection issue."
    fi
  fi
  rm -f "$_out"

  # --- RCA summary (address root cause, not symptom) ---
  echo "  --- RCA (root cause) ---"
  if [[ $_insecure_ok -eq 1 ]]; then
    echo "  📌 Root cause: TLS/certificate (API responds with --insecure-skip-tls-verify). SAN or hostname mismatch."
    echo "  Fix: Recreate cluster with tls-san=127.0.0.1: ./scripts/k3d-create-2-node-cluster.sh. Restart does not fix cert."
    _rca="TLS_cert_SAN_or_hostname_mismatch"
  elif [[ "${_rca:-}" == "TLS_handshake_api_starting" ]]; then
    echo "  📌 Root cause: API still starting (TLS handshake aborted). Do NOT auto-restart — wait and retry."
    echo "  Fix: Retry (script will retry); or wait 60–90s and run again. Restart changes API port and can loop."
  elif [[ "${_rca:-}" == "API_not_listening" ]]; then
    echo "  📌 Root cause: API not listening yet (port not open / connection refused). Do NOT auto-restart — wait and retry."
    echo "  Fix: Retry (script will run phase 2 extended wait); restart changes API port and can loop."
  elif [[ "$_tls_handshake" == "FAIL" ]]; then
    echo "  📌 Root cause: TLS handshake failed (cert/SAN/SNI or nothing listening). Do not auto-restart until TLS is fixed."
    echo "  Fix: If 127.0.0.1 not in cert → recreate cluster. If connection refused → wait/retry (API starting)."
    _rca="TLS_handshake_failed"
  elif [[ "$_tls_handshake" == "OK" ]] && [[ $_exit -ne 0 ]]; then
    echo "  📌 Root cause: TLS OK but kubectl failed → API layer (not ready, slow, or HTTP/authorization). Not a cert issue."
    echo "  Fix: Retry (script retries); or restart cluster if API never becomes ready."
    _rca="API_layer_not_ready_or_slow"
  elif echo "$_strict_err" | grep -qi "connection refused"; then
    echo "  📌 Root cause: API not ready (nothing listening on port yet)."
    echo "  Fix: Retry; or restart cluster: k3d cluster stop/start or colima restart."
    _rca="API_not_listening"
  elif echo "$_strict_err" | grep -qi "x509\|certificate.*valid for\|TLS"; then
    echo "  📌 Root cause: TLS/certificate (hostname/SAN mismatch)."
    echo "  Fix: Recreate cluster: ./scripts/k3d-create-2-node-cluster.sh."
    _rca="TLS_cert_mismatch"
  elif echo "$_strict_err" | grep -qi "timeout\|deadline exceeded"; then
    echo "  📌 Root cause: API not responding in time (slow start or overloaded)."
    echo "  Fix: Retry; increase ENSURE_CAP; or restart cluster."
    _rca="API_timeout"
  else
    echo "  📌 Root cause: Unknown (TLS/API/network). Check kubectl and openssl output above."
    echo "  Fix: Inspect $TELEMETRY_DURING; run k3d cluster list; retry."
    _rca="unknown"
  fi

  if echo "$CURRENT_CTX" | grep -q "k3d"; then
    echo "  k3d clusters:"; command -v k3d >/dev/null 2>&1 && k3d cluster list 2>&1 | sed 's/^/    /' || echo "    (k3d not in PATH)"
  fi
  if [[ "$CURRENT_CTX" == *"colima"* ]]; then
    echo "  colima status:"; command -v colima >/dev/null 2>&1 && colima status 2>&1 | sed 's/^/    /' || echo "    (colima not in PATH)"
    echo "  📌 Colima: ensure VM is up; 503 → try $SCRIPT_DIR/colima-api-status.sh or restart k3s (Runbook item 32)."
  fi
  echo "  Invariant: next attempts refresh kubeconfig (k3d) and retry. Telemetry (with RCA) → $TELEMETRY_DURING"
  echo "  ---"

  # Append structured RCA to telemetry so we can inspect post-run without re-running
  if [[ -n "${TELEMETRY_DURING:-}" ]] && [[ -w "${TELEMETRY_DURING:-}" ]]; then
    {
      echo "=== api_check_failed_rca $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
      echo "context=$CURRENT_CTX port=${_port:-} tcp_127=$_tcp_127 tls_handshake=${_tls_handshake:-} sans=${_sans:-} kubectl_exit=$_exit insecure_ok=$_insecure_ok rca=${_rca:-}"
      echo "kubectl_stderr_first_line=$(echo "$_strict_err" | head -1)"
      echo "---"
    } >> "$TELEMETRY_DURING"
  fi
  # So main() can skip K3D_AUTO_RESTART when restart would not help (TLS handshake / cert). Use ENSURE_RCA_FILE so subshell writes to same path main() reads.
  echo "${_rca:-unknown}" > "${ENSURE_RCA_FILE:-/tmp/ensure-last-rca-$$.txt}" 2>/dev/null || true
}

# One-line reason for this attempt's failure (so each attempt is clear). Uses current kubeconfig.
_failure_reason() {
  local _s _port _tcp=0
  _s=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  if [[ -n "$_s" ]] && [[ "$_s" =~ :([0-9]+) ]]; then
    _port="${BASH_REMATCH[1]}"
    ( nc -z -w 2 127.0.0.1 "$_port" 2>/dev/null || nc -z -G 2 127.0.0.1 "$_port" 2>/dev/null ) && _tcp=1
  fi
  if [[ $_tcp -eq 1 ]]; then
    echo "port open but kubectl failed (API not ready or TLS/SNI)"
  else
    echo "port not open (API starting or wrong port)"
  fi
}

# For k3d: refresh kubeconfig and re-apply 127.0.0.1 so we never use a stale port (invariant).
_refresh_k3d_kubeconfig() {
  local _k3d_name="${CURRENT_CTX#k3d-}"
  k3d kubeconfig merge "$_k3d_name" --kubeconfig-merge-default 2>/dev/null || true
  _s=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  _c=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
  if [[ -n "$_s" ]] && [[ -n "$_c" ]] && [[ "$_s" != *"127.0.0.1"* ]] && [[ "$_s" =~ :([0-9]+) ]]; then
    kubectl config set-cluster "$_c" --server="https://127.0.0.1:${BASH_REMATCH[1]}" >/dev/null 2>&1 || true
  fi
}

wait_for_api_server() {
  local attempt=1 _reason
  while [[ $attempt -le $MAX_ATTEMPTS ]]; do
    # k3d: refresh kubeconfig before every attempt so we never hit a stale port (invariant)
    if [[ "$CURRENT_CTX" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
      _refresh_k3d_kubeconfig
    fi
    echo "  [attempt $attempt/$MAX_ATTEMPTS] Checking API server (${ATTEMPT_TIMEOUT}s per attempt, ${ENSURE_CAP}s cap)..."
    ( _one_attempt; echo $? > /tmp/ensure-attempt-$$.ret ) & apid=$!
    ( sleep "$ATTEMPT_TIMEOUT"; kill -9 $apid 2>/dev/null ) & tpid=$!
    wait $apid 2>/dev/null || true
    kill $tpid 2>/dev/null || true
    wait $tpid 2>/dev/null || true
    r=$(cat /tmp/ensure-attempt-$$.ret 2>/dev/null || echo 1)
    rm -f /tmp/ensure-attempt-$$.ret
    if [[ "$r" == "0" ]]; then
      ok "API server ready (attempt $attempt/$MAX_ATTEMPTS)"
      return 0
    fi
    # On first failure with k3d, if server is not 127.0.0.1, switch to 127.0.0.1 once (TLS/SNI; host.docker.internal, localhost, etc.)
    if [[ $attempt -eq 1 ]] && [[ "$CURRENT_CTX" == *"k3d"* ]]; then
      _s=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
      _c=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
      if [[ "$_s" != *"127.0.0.1"* ]] && [[ "$_s" =~ :([0-9]+) ]]; then
        _p="${BASH_REMATCH[1]}"
        if kubectl config set-cluster "$_c" --server="https://127.0.0.1:$_p" >/dev/null 2>&1; then
          if _one_attempt 2>/dev/null; then
            ok "API server ready (attempt $attempt/$MAX_ATTEMPTS; fixed by using 127.0.0.1:$_p)"
            return 0
          fi
          kubectl config set-cluster "$_c" --server="$_s" >/dev/null 2>&1 || true
        fi
      fi
    fi
    _reason=$(_failure_reason)
    warn "Attempt $attempt/$MAX_ATTEMPTS failed: $_reason — waiting ${SLEEP}s then retrying..."
    if [[ $attempt -eq 1 ]]; then
      _show_why_not_ready
    fi
    sleep "$SLEEP"
    attempt=$((attempt + 1))
  done
  warn "API server check failed after ${MAX_ATTEMPTS} attempts."
  _show_why_not_ready
  return 0
}

# Run in subshell with timeout so we never hang before the wait loop (kubectl config view / _one_attempt can be slow).
# k3d: always use 127.0.0.1 from host (0.0.0.0, localhost, host.docker.internal, or any other host can cause TLS/SNI or intermittent failures).
_do_initial_fix() {
  local _server _cluster _port _new_server
  _server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  _cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
  if [[ -n "$_server" ]] && [[ -n "$_cluster" ]] && [[ "$CURRENT_CTX" == *"k3d"* ]]; then
    if [[ "$_server" =~ ^https?://[^:/]+:([0-9]+) ]]; then
      _port="${BASH_REMATCH[1]}"
      _new_server="https://127.0.0.1:$_port"
      # Normalize to 127.0.0.1 for any non-127.0.0.1 host (0.0.0.0, localhost, host.docker.internal, serverlb name, etc.)
      if [[ "$_server" != *"127.0.0.1"* ]]; then
        if kubectl config set-cluster "$_cluster" --server="$_new_server" >/dev/null 2>&1; then
          if _one_attempt 2>/dev/null; then
            ok "kubeconfig: API server set to $_new_server (strict TLS)"
          else
            # Keep 127.0.0.1 so wait loop and diagnostics use it; TLS may still fail if cert has no SAN
            ok "kubeconfig: API server set to $_new_server (will retry in wait loop)"
          fi
        fi
        _server="$_new_server"
      fi
      # If still localhost (e.g. after 0.0.0.0 -> localhost in older code path), switch to 127.0.0.1
      if [[ "$_server" == *"localhost"* ]]; then
        if kubectl config set-cluster "$_cluster" --server="$_new_server" >/dev/null 2>&1; then
          _one_attempt 2>/dev/null && ok "kubeconfig: API server switched to $_new_server (localhost TLS avoided)" || true
        fi
      fi
    fi
  fi
}

main() {
  # RCA file: use fixed path so subshell and main always read/write the same file ($$ can differ in background subshells).
  export ENSURE_RCA_FILE="${ENSURE_RCA_FILE:-/tmp/ensure-last-rca.txt}"
  rm -f "$ENSURE_RCA_FILE" 2>/dev/null || true
  say "=== Ensuring Kubernetes API server is ready ==="
  echo "  Invariant: API server will be reachable; we refresh kubeconfig (k3d), fix 127.0.0.1, and retry with diagnostics until ready."
  # k3d: if cluster is stopped, either start it and keep going (K3D_AUTO_RESTART=1) or fail with instructions.
  if [[ "$CURRENT_CTX" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
    _k3d_name="${CURRENT_CTX#k3d-}"
    _k3d_list=$(k3d cluster list --no-headers 2>/dev/null || true)
    if ! echo "$_k3d_list" | grep -q "^$_k3d_name "; then
      warn "k3d cluster '$_k3d_name' not found. Create it: $SCRIPT_DIR/k3d-create-2-node-cluster.sh"
      echo "  Run deep diagnostic: $SCRIPT_DIR/diagnose-k3d-api-deep.sh"
      return 1
    fi
    # SERVERS column is 2nd; "0" or "0/1" = not running
    _servers=$(echo "$_k3d_list" | awk -v n="$_k3d_name" '$1==n {print $2; exit}' || true)
    if [[ -z "$_servers" ]] || [[ "$_servers" =~ ^0 ]]; then
      if [[ "${K3D_AUTO_RESTART:-0}" == "1" ]]; then
        say "k3d cluster '$_k3d_name' is stopped; starting it (K3D_AUTO_RESTART=1) and continuing..."
        k3d cluster start "$_k3d_name" 2>/dev/null || true
        K3D_POST_RESTART_WAIT="${K3D_POST_RESTART_WAIT:-60}"
        echo "  Waiting ${K3D_POST_RESTART_WAIT}s for API server after start..."
        sleep "$K3D_POST_RESTART_WAIT"
        k3d kubeconfig merge "$_k3d_name" --kubeconfig-merge-default 2>/dev/null || true
      else
        warn "k3d cluster '$_k3d_name' is not running (API server will be refused)."
        echo "  Start the cluster: k3d cluster start $_k3d_name"
        echo "  Or re-run preflight with K3D_AUTO_RESTART=1 so the script can start it and keep going."
        echo "  Run deep diagnostic: $SCRIPT_DIR/diagnose-k3d-api-deep.sh"
        return 1
      fi
    else
      k3d kubeconfig merge "$_k3d_name" --kubeconfig-merge-default 2>/dev/null && echo "  k3d: merged kubeconfig for $_k3d_name (current API port)" || true
    fi
  fi
  [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]] && \
    PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || true
  echo "  Checking API server (kubeconfig + 127.0.0.1 fix for k3d; each attempt refreshes kubeconfig on k3d)..."
  # Cap the initial kubeconfig/one_attempt block so we never hang here (e.g. kubectl config view or _one_attempt stuck)
  INITIAL_CAP="${ENSURE_INITIAL_CAP:-60}"
  ( _do_initial_fix ) & _init_pid=$!
  ( sleep "$INITIAL_CAP"; kill -9 $_init_pid 2>/dev/null ) & _init_kill=$!
  wait $_init_pid 2>/dev/null || true
  _init_ret=$?
  kill $_init_kill 2>/dev/null || true
  wait $_init_kill 2>/dev/null || true
  if [[ $_init_ret -eq 137 ]] || [[ $_init_ret -eq 143 ]]; then
    warn "Initial API check timed out after ${INITIAL_CAP}s; continuing to wait loop."
  fi
  echo "  (Total wait capped at ${ENSURE_CAP}s; ${MAX_ATTEMPTS} attempts, ${SLEEP}s between)"
  sleep 3
  ( wait_for_api_server; echo $? > /tmp/ensure-$$.ret ) & wpid=$!
  ( sleep "$ENSURE_CAP"; kill -9 $wpid 2>/dev/null ) & kpid=$!
  wait $wpid 2>/dev/null || true
  r=$(cat /tmp/ensure-$$.ret 2>/dev/null || echo 1)
  rm -f /tmp/ensure-$$.ret
  kill $kpid 2>/dev/null || true
  wait $kpid 2>/dev/null || true
  _last_rca=""
  [[ -n "${ENSURE_RCA_FILE:-}" ]] && [[ -f "$ENSURE_RCA_FILE" ]] && _last_rca=$(cat "$ENSURE_RCA_FILE" 2>/dev/null) || true
  # Phase 2: When root cause is "API still starting", "TLS handshake failed" (may be API starting), or "API not listening", do extended wait (retry) instead of restart. Restart can change API port and make things worse.
  PHASE2_ATTEMPTS="${ENSURE_API_PHASE2_ATTEMPTS:-15}"
  if [[ "$r" != "0" ]] && { [[ "${_last_rca:-}" == "TLS_handshake_api_starting" ]] || [[ "${_last_rca:-}" == "TLS_handshake_failed" ]] || [[ "${_last_rca:-}" == "API_not_listening" ]] || [[ "${_last_rca:-}" == "API_layer_not_ready_or_slow" ]]; }; then
    say "API not ready yet (${_last_rca:-}); attempting to fix by retry (phase 2: $PHASE2_ATTEMPTS more attempts) — will NOT auto-restart control plane."
    echo "  (Root cause: TLS handshake / API not listening / still starting; retrying instead of restarting.)"
    _phase2_max=$PHASE2_ATTEMPTS
    _phase2_attempt=1
    while [[ $_phase2_attempt -le $_phase2_max ]]; do
      [[ "$CURRENT_CTX" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1 && _refresh_k3d_kubeconfig
      echo "  [phase 2 attempt $_phase2_attempt/$_phase2_max] Checking API server..."
      if _one_attempt 2>/dev/null; then
        ok "API server ready after phase 2 (attempt $_phase2_attempt)"
        r=0
        break
      fi
      sleep "$SLEEP"
      _phase2_attempt=$((_phase2_attempt + 1))
    done
    [[ "$r" != "0" ]] && warn "Phase 2 exhausted ($_phase2_max attempts); API still not ready. Do not restart — wait for cluster to settle or check control plane."
  fi
  # Skip auto-restart when failure is TLS handshake or API not ready — restart won't fix and can change API port (loop).
  _skip_restart=0
  case "${_last_rca:-}" in
    TLS_handshake_failed|TLS_handshake_api_starting|API_not_listening|API_layer_not_ready_or_slow|TLS_cert_SAN_or_hostname_mismatch|TLS_cert_mismatch)
      _skip_restart=1
      ;;
  esac
  if [[ "$r" != "0" ]] && [[ "${K3D_AUTO_RESTART:-0}" == "1" ]] && [[ "$CURRENT_CTX" == *"k3d"* ]] && [[ "$_skip_restart" -eq 1 ]]; then
    info "Skipping k3d auto-restart (failure was $_last_rca; restart would not help and can change API port)."
  fi
  # Only after all fix attempts (phase 1 + phase 2 when applicable): consider restart as last resort, and only when RCA suggests restart might help.
  if [[ "$r" != "0" ]] && [[ "${K3D_AUTO_RESTART:-0}" == "1" ]] && [[ "$CURRENT_CTX" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1 && [[ $_skip_restart -eq 0 ]]; then
    _cluster="${CURRENT_CTX#k3d-}"
    say "k3d: API check failed; auto-restarting cluster $_cluster (K3D_AUTO_RESTART=1)..."
    echo "  (If Diagnosis above was 'TLS/certificate' or 'SAN', restart will not fix — recreate cluster with ./scripts/k3d-create-2-node-cluster.sh)"
    k3d cluster stop "$_cluster" 2>/dev/null || true
    sleep 2
    k3d cluster start "$_cluster" 2>/dev/null || true
    # Give k3s/etcd time to come up so post-restart check doesn't hit TLS/not-ready again (HA: one restart should suffice).
    K3D_POST_RESTART_WAIT="${K3D_POST_RESTART_WAIT:-60}"
    _msg="Waiting ${K3D_POST_RESTART_WAIT}s for API server after restart..."
    ok "$_msg"
    sleep "$K3D_POST_RESTART_WAIT"
    ( wait_for_api_server; echo $? > /tmp/ensure-$$.ret ) & wpid=$!
    ( sleep "$ENSURE_CAP"; kill -9 $wpid 2>/dev/null ) & kpid=$!
    wait $wpid 2>/dev/null || true
    r=$(cat /tmp/ensure-$$.ret 2>/dev/null || echo 1)
    rm -f /tmp/ensure-$$.ret
    kill $kpid 2>/dev/null || true
    wait $kpid 2>/dev/null || true
  fi
  if [[ "$r" != "0" ]]; then
    warn "API server check capped or failed; cannot proceed."
    echo "  Run deep diagnostic: $SCRIPT_DIR/diagnose-k3d-api-deep.sh"
    return 1
  fi
  return 0
}

main "$@"
