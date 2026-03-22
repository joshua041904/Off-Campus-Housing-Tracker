#!/usr/bin/env bash
# Re-issue CA + leaf certs and load into all services.
#
# WHEN TO RUN: Test suite fails with "curl exit 60" or "CA and Caddy don't match".
# Same CA signs the leaf; dev-root-ca (tests) and off-campus-housing-local-tls (Caddy) stay in sync.
#
# Updates: dev-root-ca, LEAF_TLS_SECRET (default off-campus-housing-local-tls), service-tls (off-campus-housing-tracker + ingress-nginx),
# envoy-test (via sync-envoy-tls-secrets), certs/, restarts Caddy and optionally all services.
#
# Prerequisites: Cluster reachable (kubectl cluster-info), openssl.
# Run from repo root, or ensure PATH includes scripts/shims for kubectl.
#
# Usage: ./scripts/reissue-ca-and-leaf-load-all-services.sh
#   RESTART_SERVICES=1     (default) — restart service deployments after updating secrets (sequential ordered rollout)
#   HOST=off-campus-housing.test      — leaf CN and SANs (default off-campus-housing.test)
#   REISSUE_CAP=0          — no cap (default). Set >0 to limit total seconds; exits 1 if exceeded.
#   CADDY_ROLLOUT_TIMEOUT  — seconds to wait for Caddy rollout (default 120)
#   CADDY_WAIT_TIMEOUT     — seconds for pod wait fallback (default 60)
#   REISSUE_VIA_SSH=1      (default) — step 2 uses colima ssh when USE_COLIMA_SSH=1 or REISSUE_STEP2_VIA_SSH=1.
#   REISSUE_STEP2_VIA_SSH=1 — force step 2 via colima ssh (bypass tunnel) for max stability. Set by preflight when using 6443.
#   REISSUE_STEP2_SLEEP=4 — seconds to sleep between each secret apply in step 2 (reduces API burst; default 4 when host kubectl, 2 when ssh).
#   REISSUE_SETTLE_CAP=240 — max seconds to wait for API to settle after step 2 (default 240, k3d 90); poll every 10s.
#   REISSUE_STEP2_USE_APPLY=1 (default) — use kubectl apply -f (single write per secret). Set 0 to use legacy delete+create.
#   REISSUE_PHASE1_ABORT=1 (default) — Phase 1: health gate before first apply; abort on first write failure (max 1 retry after readyz). Set 0 for legacy 12 retries.
#   REISSUE_STEP2_SLEEP=5 — when REISSUE_PHASE1_ABORT=1 we enforce at least 5s between mutating calls.
#   OCH_ROLLOUT_STATUS_TIMEOUT — seconds for each kubectl rollout status during step 7 (default 180).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Do NOT put scripts/shims first: the kubectl shim redirects stderr to /dev/null and can fall back to
# colima ssh, which cannot read host paths like $TMP. That caused silent failures in step 2 (create secret).
export PATH="/opt/homebrew/bin:/usr/local/bin:${SCRIPT_DIR}/shims:${PATH:-}"
cd "$REPO_ROOT"

NS_ING="ingress-nginx"
NS_APP="off-campus-housing-tracker"
LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-off-campus-housing-local-tls}"
HOST="${HOST:-off-campus-housing.test}"
RESTART_SERVICES="${RESTART_SERVICES:-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }
# Progress marker so pipeline logs show where we are (avoids "stuck at 4b" with no visibility)
log_progress() { echo "[reissue] $*"; }

_reissue_main() {
  say "=== Re-issue CA + leaf and load into all services ==="

  command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }

  log_progress "step 0: preflight (kubeconfig)…"
  # When pipeline passes a single-cluster kubeconfig (REISSUE_SKIP_PREFLIGHT=1), skip the preflight script. If get nodes fails (tunnel flaky), re-establish tunnel and retry.
  if [[ "${REISSUE_SKIP_PREFLIGHT:-0}" == "1" ]]; then
    _nodes_ok=0
    _msg="Preflight skipped (pipeline passed single-cluster config); cluster reachable"
    if kubectl get nodes --request-timeout=20s >/dev/null 2>&1; then
      _nodes_ok=1
    else
      ctx_pre=$(kubectl config current-context 2>/dev/null || true)
      if [[ "$ctx_pre" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
        for _retry in 1 2; do
          "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
          sleep 3
          if kubectl get nodes --request-timeout=20s >/dev/null 2>&1; then
            _nodes_ok=1
            _msg="Preflight skipped; cluster reachable after re-establishing tunnel"
            break
          fi
        done
      fi
    fi
    if [[ "$_nodes_ok" == "1" ]]; then
      ok "$_msg"
    else
      echo "❌ REISSUE_SKIP_PREFLIGHT=1 but kubectl get nodes failed (tunnel may be down). Run ./scripts/colima-forward-6443.sh then re-run." >&2
      exit 1
    fi
  else
    if [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
      PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || true
    fi
    ok "Preflight done"
  fi

  log_progress "step 0b: cluster check…"
  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  USE_COLIMA_SSH=0
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    USE_COLIMA_SSH=1
  fi

  # If config has 6443, restore native port from COLIMA_NATIVE_SERVER (set by pipeline when Colima was first reachable). Do not hardcode — native port can change.
  if [[ "$ctx" == *"colima"* ]]; then
    _server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
    if [[ "$_server" == *"6443"* ]] && [[ -n "${COLIMA_NATIVE_SERVER:-}" ]]; then
      _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
      _p=$(echo "$COLIMA_NATIVE_SERVER" | sed -n 's|.*:\([0-9]*\)$|\1|p')
      if [[ -n "$_p" ]]; then
        kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:$_p" >/dev/null 2>&1 || true
        if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
          ok "Cluster reachable (127.0.0.1:$_p, was 6443 — using saved native port)"
          USE_COLIMA_SSH=0
        fi
      fi
    fi
  fi

  # When using colima ssh, VM default kubeconfig points to 127.0.0.1:52215 (refused). Override to 6443 (k3s inside VM).
  _colima_kubectl() {
    colima ssh -- kubectl --server="https://127.0.0.1:6443" --request-timeout=20s "$@" 2>/dev/null || colima ssh -- kubectl --server="https://127.0.0.1:6443" --request-timeout=20s "$@"
  }
  kctl() {
    if [[ "${USE_COLIMA_SSH}" == "1" ]]; then
      _colima_kubectl "$@"
    else
      kubectl --request-timeout=20s "$@" 2>/dev/null || kubectl --request-timeout=20s "$@"
    fi
  }

  _cluster_reachable() {
    kubectl cluster-info --request-timeout=15s >/dev/null 2>&1
  }
  if _cluster_reachable; then
    ok "Cluster reachable"
    USE_COLIMA_SSH=0
  elif sleep 3 && _cluster_reachable; then
    ok "Cluster reachable (after retry)"
    USE_COLIMA_SSH=0
  else
    # Try native ports on host (never 6443). Prefer COLIMA_NATIVE_SERVER port if set by pipeline, then current config, then fallbacks.
    _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    _native_port=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null | sed -n 's|.*:\([0-9]*\)$|\1|p')
    _saved_port=""
    [[ -n "${COLIMA_NATIVE_SERVER:-}" ]] && _saved_port=$(echo "$COLIMA_NATIVE_SERVER" | sed -n 's|.*:\([0-9]*\)$|\1|p')
    for _try in $_saved_port $_native_port 51819 49400; do
      [[ -z "$_try" ]] && continue
      [[ "$_try" == "6443" ]] && continue
      kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:$_try" >/dev/null 2>&1 || true
      sleep 2
      if _cluster_reachable; then
        ok "Cluster reachable (127.0.0.1:$_try)"
        USE_COLIMA_SSH=0
        break
      fi
    done
    if ! _cluster_reachable && [[ "${USE_COLIMA_SSH}" == "1" ]] && colima ssh -- kubectl cluster-info --request-timeout=15s >/dev/null 2>&1; then
      # Colima ssh works but host doesn't. Try saved native port then fallbacks so step 2 can use host kubectl.
      for _try in $_saved_port 51819 49400; do
        [[ -z "$_try" ]] && continue
        kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:$_try" >/dev/null 2>&1 || true
        sleep 2
        if _cluster_reachable; then
          ok "Cluster reachable (127.0.0.1:$_try) — host fixed for step 2"
          USE_COLIMA_SSH=0
          break
        fi
      done
    fi
    if ! _cluster_reachable; then
      if [[ "${USE_COLIMA_SSH}" == "1" ]] && colima ssh -- kubectl cluster-info --request-timeout=15s >/dev/null 2>&1; then
        ok "Cluster reachable (colima ssh only — step 2 will use VM kubectl with 6443)"
      else
        echo "❌ Cluster not reachable. Colima: colima start --with-kubernetes; ensure host can reach API (native port 51819/49400)."
        exit 1
      fi
    fi
  fi

  log_progress "step 0c: namespaces…"
  for n in "$NS_APP" "$NS_ING" "envoy-test"; do
    kctl create namespace "$n" 2>/dev/null || true
  done
  ok "Namespaces $NS_APP, $NS_ING, envoy-test ensured"

  TMP="$REPO_ROOT/.reissue-tmp.$$"
  mkdir -p "$TMP"
  trap 'rm -rf "$TMP"' EXIT
  CA_KEY="$TMP/ca.key"
  CA_CRT="$TMP/ca.crt"
  LEAF_KEY="$TMP/tls.key"
  LEAF_CRT="$TMP/tls.crt"

  CLUSTERIP_FQDN="caddy-h3.ingress-nginx.svc.cluster.local"
  SANS="DNS:${HOST},DNS:*.${HOST},DNS:localhost,DNS:${CLUSTERIP_FQDN}"
  SANS="${SANS},DNS:*.ingress-nginx.svc.cluster.local,DNS:*.off-campus-housing-tracker.svc.cluster.local"
  SANS="${SANS},DNS:auth-service.off-campus-housing-tracker.svc.cluster.local,DNS:listings-service.off-campus-housing-tracker.svc.cluster.local"
  SANS="${SANS},DNS:booking-service.off-campus-housing-tracker.svc.cluster.local,DNS:messaging-service.off-campus-housing-tracker.svc.cluster.local"
  SANS="${SANS},DNS:trust-service.off-campus-housing-tracker.svc.cluster.local,DNS:analytics-service.off-campus-housing-tracker.svc.cluster.local"
  SANS="${SANS},DNS:api-gateway.off-campus-housing-tracker.svc.cluster.local,IP:127.0.0.1,IP:::1"

  log_progress "step 1: generating CA and leaf…"
  say "1. Generating new CA and leaf…"
  openssl genrsa -out "$CA_KEY" 2048 2>/dev/null
  openssl req -new -x509 -days 3650 -key "$CA_KEY" -out "$CA_CRT" \
    -subj "/CN=dev-root-ca/O=off-campus-housing-tracker" 2>/dev/null
  ok "CA generated"

  openssl genrsa -out "$LEAF_KEY" 2048 2>/dev/null
  openssl req -new -key "$LEAF_KEY" -out "$TMP/leaf.csr" \
    -subj "/CN=${HOST}/O=off-campus-housing-tracker" 2>/dev/null
  cat > "$TMP/ext.conf" <<EXT
[v3_req]
subjectAltName=$SANS
EXT
  openssl x509 -req -in "$TMP/leaf.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" \
    -CAcreateserial -out "$LEAF_CRT" -days 365 \
    -extensions v3_req -extfile "$TMP/ext.conf" 2>/dev/null
  ok "Leaf generated (SANs: $HOST, localhost, ClusterIP, services)"

  # Edge (Caddy) and service-tls: tls.crt = leaf only; ca.crt / dev-root.pem = trust anchor (no chain concatenation).
  ok "Leaf certificate ready (tls.crt will be leaf-only; verify with --cacert dev-root.pem)"

  log_progress "step 2: updating secrets…"
  say "2. Updating secrets (off-campus-housing-tracker + ingress-nginx)…"
  # Prefer colima ssh for step 2 when on Colima so the create-secret burst never goes through the host tunnel (max stability).
  # REISSUE_STEP2_VIA_SSH=1 (set by preflight) forces this even when host kubectl works; avoids tunnel resets under load.
  REISSUE_VIA_SSH="${REISSUE_VIA_SSH:-1}"
  REISSUE_STEP2_VIA_SSH="${REISSUE_STEP2_VIA_SSH:-0}"
  SSH_DIR=""
  _use_ssh_step2=0
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && [[ "$REISSUE_VIA_SSH" == "1" ]]; then
    [[ "${USE_COLIMA_SSH}" == "1" ]] && _use_ssh_step2=1
    [[ "${REISSUE_STEP2_VIA_SSH}" == "1" ]] && _use_ssh_step2=1
  fi
  if [[ "$_use_ssh_step2" == "1" ]]; then
    SSH_DIR="$REPO_ROOT/.reissue-ssh-$$"
    mkdir -p "$SSH_DIR"
    cp "$LEAF_CRT" "$SSH_DIR/tls.crt"
    cp "$LEAF_KEY" "$SSH_DIR/tls.key"
    cp "$CA_CRT" "$SSH_DIR/dev-root.pem"
    cp "$CA_CRT" "$SSH_DIR/ca.crt"
    trap 'rm -rf "$REPO_ROOT/.reissue-ssh-'"$$"'"' EXIT
    [[ "${REISSUE_STEP2_VIA_SSH}" == "1" ]] && echo "  Using colima ssh for step 2 (REISSUE_STEP2_VIA_SSH=1 — bypass tunnel for stability)." || echo "  Using colima ssh for step 2 (host API unreachable)."
    # Prefer VM kubeconfig: inside Colima VM, default shell may not have KUBECONFIG or kubectl in PATH; k3s uses /etc/rancher/k3s/k3s.yaml.
    COLIMA_VM_SERVER=""
    USE_VM_DEFAULT_KUBECONFIG=0
    if colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
      USE_VM_DEFAULT_KUBECONFIG=1
      _k3s_line=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1' 2>/dev/null || true)
      if [[ -n "$_k3s_line" ]]; then
        _url=$(echo "$_k3s_line" | sed -n 's/.*server:[ 	]*\(https:\/\/[^ 	]*\).*/\1/p' | tr -d ' ')
        [[ -n "$_url" ]] && COLIMA_VM_SERVER="$_url"
      fi
      echo "  In-VM API: KUBECONFIG=/etc/rancher/k3s/k3s.yaml — stable path${COLIMA_VM_SERVER:+ (--server=$COLIMA_VM_SERVER)}"
    elif colima ssh -- bash -lc 'env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --request-timeout=8s' >/dev/null 2>&1; then
      USE_VM_DEFAULT_KUBECONFIG=1
      _k3s_line=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1' 2>/dev/null || true)
      if [[ -n "$_k3s_line" ]]; then
        _url=$(echo "$_k3s_line" | sed -n 's/.*server:[ 	]*\(https:\/\/[^ 	]*\).*/\1/p' | tr -d ' ')
        [[ -n "$_url" ]] && COLIMA_VM_SERVER="$_url"
      fi
      echo "  In-VM API: KUBECONFIG=/etc/rancher/k3s/k3s.yaml (login shell) — stable path${COLIMA_VM_SERVER:+ (--server=...)}"
    elif colima ssh -- kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
      USE_VM_DEFAULT_KUBECONFIG=1
      echo "  In-VM API: using VM default kubeconfig (no --server) — stable path"
    else
      _k3s_line=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1' 2>/dev/null || true)
      if [[ -n "$_k3s_line" ]]; then
        _url=$(echo "$_k3s_line" | sed -n 's/.*server:[ 	]*\(https:\/\/[^ 	]*\).*/\1/p' | tr -d ' ')
        if [[ -n "$_url" ]] && colima ssh -- kubectl --server="$_url" get nodes --request-timeout=8s >/dev/null 2>&1; then
          COLIMA_VM_SERVER="$_url"
          echo "  In-VM API: $_url (from k3s.yaml — may be ephemeral)"
        fi
      fi
      if [[ -z "$COLIMA_VM_SERVER" ]]; then
        for _p in 51819 6443; do
          if colima ssh -- kubectl --server="https://127.0.0.1:$_p" get nodes --request-timeout=8s >/dev/null 2>&1; then
            COLIMA_VM_SERVER="https://127.0.0.1:$_p"
            echo "  In-VM API: $COLIMA_VM_SERVER (probed)"
            break
          fi
        done
      fi
      if [[ -z "$COLIMA_VM_SERVER" ]]; then
        echo "  ⚠️  Could not detect in-VM k3s API. Falling back to host kubectl for step 2."
        echo "  Quick status (what is running / what is not): $REPO_ROOT/scripts/colima-api-status.sh"
        echo "  In-VM diagnostic:"
        _diag=$(colima ssh -- sh -c 'test -r /etc/rancher/k3s/k3s.yaml 2>/dev/null && echo k3s.yaml:readable || echo k3s.yaml:not-readable; which kubectl 2>/dev/null || echo kubectl:not-found; env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --request-timeout=5s 2>&1' 2>&1 | head -10)
        [[ -n "$_diag" ]] && echo "$_diag" | sed 's/^/    /'
        SSH_DIR=""
        COLIMA_VM_SERVER=""
      fi
    fi
  else
    if [[ "$ctx" == *"k3d"* ]]; then
      echo "  Using host kubectl for step 2 (k3d — current kubeconfig server, no 6443 pin)."
    else
      echo "  Using host kubectl for step 2 (pinned 127.0.0.1:6443; retries on tunnel reset)."
    fi
  fi
  # k3d: refresh kubeconfig before step 2 so API server port is current (dynamic port, not 6443).
  if [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
    k3d kubeconfig merge off-campus-housing-tracker 2>/dev/null || true
  fi
  # Rate-limit step 2: longer sleep when using host/tunnel (reduces connection resets).
  if [[ -n "${REISSUE_STEP2_SLEEP:-}" ]]; then
    STEP2_SLEEP="$REISSUE_STEP2_SLEEP"
  elif [[ -z "$SSH_DIR" ]]; then
    STEP2_SLEEP=4
  else
    STEP2_SLEEP=2
  fi
  FALLBACK_TO_HOST_STEP2=0
  _kubectl_host() { kubectl --request-timeout=45s "$@"; }
  _resolve_colima_vm_server() {
    local _line _url
    _line=$(colima ssh -- sh -c 'grep -E "server:.*https://" /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1' 2>/dev/null || true)
    if [[ -n "$_line" ]]; then
      _url=$(echo "$_line" | sed -n 's/.*server:[ 	]*\(https:\/\/[^ 	]*\).*/\1/p' | tr -d ' ')
      if [[ -n "$_url" ]] && colima ssh -- kubectl --server="$_url" get nodes --request-timeout=5s >/dev/null 2>&1; then
        COLIMA_VM_SERVER="$_url"
        return 0
      fi
    fi
    for _p in 6443 51819; do
      if colima ssh -- kubectl --server="https://127.0.0.1:$_p" get nodes --request-timeout=5s >/dev/null 2>&1; then
        COLIMA_VM_SERVER="https://127.0.0.1:$_p"
        return 0
      fi
    done
    return 1
  }
  _kubectl_step2() {
    if [[ "${FALLBACK_TO_HOST_STEP2:-0}" == "1" ]]; then
      _kubectl_host "$@"
      return
    fi
    if [[ -n "$SSH_DIR" ]]; then
      if [[ -n "${COLIMA_VM_SERVER:-}" ]]; then
        colima ssh -- kubectl --server="${COLIMA_VM_SERVER}" --request-timeout=45s "$@"
      elif [[ "${USE_VM_DEFAULT_KUBECONFIG:-0}" == "1" ]]; then
        colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl --request-timeout=45s "$@" 2>/dev/null || colima ssh -- kubectl --request-timeout=45s "$@"
      else
        _kubectl_host "$@"
      fi
    else
      _kubectl_host "$@"
    fi
  }
  # Phase 1 (ETCD_WRITE_BUDGET_PLAN): 3× readyz, 2s apart; exit 1 if any fail.
  _readyz_3x() {
    local i
    for i in 1 2 3; do
      if ! _kubectl_step2 get --raw='/readyz' --request-timeout=15s >/dev/null 2>&1; then
        return 1
      fi
      [[ $i -lt 3 ]] && sleep 2
    done
    return 0
  }
  _apply_with_retry() {
    local max=12 i=1
    while [[ $i -le $max ]]; do
      local out_err="$TMP/reissue-step2-out-$$" err_err="$TMP/reissue-step2-err-$$"
      if _kubectl_step2 "$@" > "$out_err" 2> "$err_err"; then
        cat "$out_err"
        rm -f "$out_err" "$err_err"
        return 0
      fi
      local out=$(cat "$out_err" 2>/dev/null)
      local err=$(cat "$err_err" 2>/dev/null)
      if echo "$err" | grep -q "already exists"; then
        rm -f "$out_err" "$err_err"
        return 0
      fi
      if [[ $i -lt $max ]]; then
        local backoff=10
        echo "$err" | grep -qE "ServiceUnavailable|unable to handle|connection reset" && backoff=18
        if echo "$err" | grep -qi "connection refused\|dial tcp.*connect: connection refused\|apiserver not ready"; then
          echo "  (in-VM API issue — re-resolving...)"
          if _resolve_colima_vm_server; then
            echo "  (using ${COLIMA_VM_SERVER})"
          elif [[ "${FALLBACK_TO_HOST_STEP2:-0}" != "1" ]]; then
            FALLBACK_TO_HOST_STEP2=1
            echo "  (in-VM API unreachable — using host kubectl / tunnel 6443 for rest of step 2; Runbook: why step 2 slow)"
          fi
        fi
        warn "Attempt $i/$max failed (retry in ${backoff}s): _kubectl_step2 $*"
        [[ -n "$err" ]] && echo "$err" | sed 's/^/  /'
        sleep "$backoff"
      else
        echo "❌ Reissue step 2 failed after $max attempts. Last command: _kubectl_step2 $*" >&2
        [[ -n "$err" ]] && echo "$err" | sed 's/^/  /' >&2
        echo "  To inspect API: kubectl get nodes; colima ssh -- 'kubectl top nodes 2>/dev/null'" >&2
        rm -f "$out_err" "$err_err"
        return 1
      fi
      i=$((i + 1))
    done
    return 1
  }
  # Step 2 apply path: single write per secret (no delete storm). See docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md.
  _b64() { base64 < "$1" | tr -d '\n'; }
  _apply_yaml_with_retry() {
    local yaml_file="$1"
    local max=12 i=1
    if [[ "${REISSUE_PHASE1_ABORT:-1}" == "1" ]]; then
      max=2
    fi
    # --validate=false avoids downloading OpenAPI when API is under load ("server currently unable to handle the request")
    while [[ $i -le $max ]]; do
      local err_err="$TMP/reissue-apply-err-$$"
      if cat "$yaml_file" | _kubectl_step2 apply -f - --validate=false 2> "$err_err"; then
        rm -f "$err_err"
        return 0
      fi
      local err=$(cat "$err_err" 2>/dev/null)
      if [[ $i -lt $max ]]; then
        if [[ "${REISSUE_PHASE1_ABORT:-1}" == "1" ]]; then
          warn "Attempt $i/$max failed: apply -f (secret)"
          [[ -n "$err" ]] && echo "$err" | sed 's/^/  /'
          if ! _readyz_3x; then
            echo "❌ Apiserver unhealthy (readyz failed); cert rotation aborted to protect control plane." >&2
            rm -f "$err_err"
            return 1
          fi
          # One retry only after healthy
        else
          local backoff=10
          echo "$err" | grep -qE "ServiceUnavailable|unable to handle|connection reset" && backoff=18
          if echo "$err" | grep -qi "connection refused\|apiserver not ready"; then
            _resolve_colima_vm_server 2>/dev/null || true
            [[ "${FALLBACK_TO_HOST_STEP2:-0}" != "1" ]] && FALLBACK_TO_HOST_STEP2=1
          fi
          warn "Attempt $i/$max failed (retry in ${backoff}s): apply -f (secret)"
          [[ -n "$err" ]] && echo "$err" | sed 's/^/  /'
          sleep "$backoff"
        fi
      else
        echo "❌ Reissue step 2 (apply) failed after $max attempts." >&2
        [[ "${REISSUE_PHASE1_ABORT:-1}" == "1" ]] && echo "❌ Cert rotation aborted to protect control plane. Cluster is still usable. Re-run preflight without reissue (e.g. skip 3a) or fix cluster and retry." >&2
        [[ -n "$err" ]] && echo "$err" | sed 's/^/  /' >&2
        rm -f "$err_err"
        return 1
      fi
      i=$((i + 1))
      rm -f "$err_err"
    done
    return 1
  }
  USE_APPLY="${REISSUE_STEP2_USE_APPLY:-1}"
  REISSUE_PHASE1_ABORT="${REISSUE_PHASE1_ABORT:-1}"
  if [[ "$REISSUE_PHASE1_ABORT" == "1" ]] && [[ "${STEP2_SLEEP:-0}" -lt 5 ]]; then
    STEP2_SLEEP=5
  fi
  # Warm the tunnel before first heavy request.
  if [[ -z "$SSH_DIR" ]]; then
    _kubectl_step2 get ns off-campus-housing-tracker --request-timeout=15s >/dev/null 2>&1 || true
    sleep "$STEP2_SLEEP"
  fi
  sleep "$STEP2_SLEEP"

  if [[ "$USE_APPLY" == "1" ]]; then
    # Phase 1: health gate before any apply (docs/ETCD_WRITE_BUDGET_PLAN).
    if [[ "$REISSUE_PHASE1_ABORT" == "1" ]]; then
      if ! _readyz_3x; then
        if [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
          k3d kubeconfig merge off-campus-housing-tracker 2>/dev/null || true
          sleep 10
          _readyz_3x || true
        fi
        if ! _readyz_3x; then
          echo "❌ Apiserver unhealthy (readyz failed); cert rotation aborted to protect control plane." >&2
          return 1
        fi
      fi
    fi
    # Secret type is immutable: if leaf TLS secret exists as kubernetes.io/tls, apply with type Opaque fails. Delete first then apply.
    for n in "$NS_APP" "$NS_ING"; do
      _kubectl_step2 -n "$n" delete secret "$LEAF_TLS_SECRET" --ignore-not-found 2>/dev/null || true
      sleep "$STEP2_SLEEP"
    done
    for n in "$NS_APP" "$NS_ING"; do
      local f_rlt="$TMP/secret-leaf-tls-$n.yaml"
      echo "apiVersion: v1
kind: Secret
metadata:
  name: $LEAF_TLS_SECRET
  namespace: $n
type: Opaque
data:
  tls.crt: \"$(_b64 "$LEAF_CRT")\"
  tls.key: \"$(_b64 "$LEAF_KEY")\"" > "$f_rlt"
      _apply_yaml_with_retry "$f_rlt" || return 1
      sleep "$STEP2_SLEEP"
      local f_ca="$TMP/secret-dev-root-ca-$n.yaml"
      echo "apiVersion: v1
kind: Secret
metadata:
  name: dev-root-ca
  namespace: $n
type: Opaque
data:
  dev-root.pem: \"$(_b64 "$CA_CRT")\"" > "$f_ca"
      _apply_yaml_with_retry "$f_ca" || return 1
      sleep "$STEP2_SLEEP"
      if [[ "$REISSUE_PHASE1_ABORT" == "1" ]]; then
        if ! _readyz_3x; then
          if [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
            k3d kubeconfig merge off-campus-housing-tracker 2>/dev/null || true
            sleep 10
            _readyz_3x || true
          fi
          if ! _readyz_3x; then
            echo "❌ Apiserver unhealthy after namespace $n; cert rotation aborted to protect control plane." >&2
            return 1
          fi
        fi
      fi
      [[ "$n" == "$NS_APP" ]] && sleep 15
    done
    ok "$LEAF_TLS_SECRET (edge leaf-only tls.crt) and dev-root-ca updated in both namespaces (apply)"
    # Secret type is immutable: delete service-tls before apply so we can set type Opaque.
    _kubectl_step2 -n "$NS_APP" delete secret service-tls --ignore-not-found 2>/dev/null || true
    sleep "$STEP2_SLEEP"
    local f_svc="$TMP/secret-service-tls.yaml"
    echo "apiVersion: v1
kind: Secret
metadata:
  name: service-tls
  namespace: $NS_APP
type: Opaque
data:
  tls.crt: \"$(_b64 "$LEAF_CRT")\"
  tls.key: \"$(_b64 "$LEAF_KEY")\"
  ca.crt: \"$(_b64 "$CA_CRT")\"" > "$f_svc"
    _apply_yaml_with_retry "$f_svc" || return 1
    sleep "$STEP2_SLEEP"
    ok "service-tls updated (off-campus-housing-tracker) — tls.crt=leaf only, ca.crt=CA (apply)"
  else
    # Legacy: delete + create (more writes, more watch churn).
    for n in "$NS_APP" "$NS_ING"; do
      _kubectl_step2 -n "$n" delete secret "$LEAF_TLS_SECRET" 2>/dev/null || true
      sleep "$STEP2_SLEEP"
      if [[ -n "$SSH_DIR" ]]; then
        _apply_with_retry -n "$n" create secret generic "$LEAF_TLS_SECRET" --from-file=tls.crt="$SSH_DIR/tls.crt" --from-file=tls.key="$SSH_DIR/tls.key"
      else
        _apply_with_retry -n "$n" create secret generic "$LEAF_TLS_SECRET" --from-file=tls.crt="$LEAF_CRT" --from-file=tls.key="$LEAF_KEY"
      fi
      sleep "$STEP2_SLEEP"
      _kubectl_step2 -n "$n" patch secret "$LEAF_TLS_SECRET" -p '{"type":"kubernetes.io/tls"}' 2>/dev/null || true
      sleep "$STEP2_SLEEP"
      _kubectl_step2 -n "$n" delete secret dev-root-ca 2>/dev/null || true
      sleep "$STEP2_SLEEP"
      if [[ -n "$SSH_DIR" ]]; then
        _apply_with_retry -n "$n" create secret generic dev-root-ca --from-file=dev-root.pem="$SSH_DIR/dev-root.pem"
      else
        _apply_with_retry -n "$n" create secret generic dev-root-ca --from-file=dev-root.pem="$CA_CRT"
      fi
      sleep "$STEP2_SLEEP"
      if [[ "$n" == "$NS_APP" ]]; then
        sleep 15
      fi
    done
    ok "$LEAF_TLS_SECRET (leaf-only tls.crt) and dev-root-ca updated in both namespaces"
    _kubectl_step2 -n "$NS_APP" delete secret service-tls 2>/dev/null || true
    sleep "$STEP2_SLEEP"
    if [[ -n "$SSH_DIR" ]]; then
      _apply_with_retry -n "$NS_APP" create secret generic service-tls --from-file=tls.crt="$SSH_DIR/tls.crt" --from-file=tls.key="$SSH_DIR/tls.key" --from-file=ca.crt="$SSH_DIR/ca.crt"
    else
      _apply_with_retry -n "$NS_APP" create secret generic service-tls --from-file=tls.crt="$LEAF_CRT" --from-file=tls.key="$LEAF_KEY" --from-file=ca.crt="$CA_CRT"
    fi
    sleep "$STEP2_SLEEP"
    ok "service-tls updated (off-campus-housing-tracker) — tls.crt=leaf only, ca.crt=CA"
  fi
  [[ -n "$SSH_DIR" ]] && rm -rf "$SSH_DIR"

  log_progress "step 3: syncing TLS to envoy-test…"
  say "3. Syncing TLS to envoy-test…"
  if [[ -f "$SCRIPT_DIR/sync-envoy-tls-secrets.sh" ]]; then
    chmod +x "$SCRIPT_DIR/sync-envoy-tls-secrets.sh" 2>/dev/null || true
    if NS_APP="$NS_APP" NS_ENVOY="envoy-test" USE_COLIMA_SSH="$USE_COLIMA_SSH" "$SCRIPT_DIR/sync-envoy-tls-secrets.sh"; then
      ok "Envoy TLS sync done"
    else
      warn "Envoy TLS sync had issues (non-fatal)"
    fi
  else
    warn "sync-envoy-tls-secrets.sh not found; skipping envoy-test"
  fi

  log_progress "step 4: writing certs to certs/…"
  say "4. Writing certs to certs/ (for Kustomize consistency)…"
  mkdir -p "$REPO_ROOT/certs"
  cp "$CA_CRT" "$REPO_ROOT/certs/dev-root.pem"
  cp "$LEAF_CRT" "$REPO_ROOT/certs/off-campus-housing.test.crt"
  cp "$LEAF_KEY" "$REPO_ROOT/certs/off-campus-housing.test.key"
  if [[ "${KAFKA_SSL:-0}" == "1" ]]; then
    cp "$CA_KEY" "$REPO_ROOT/certs/dev-root.key"
    chmod 600 "$REPO_ROOT/certs/dev-root.key" 2>/dev/null || true
    ok "certs/dev-root.pem|.key, off-campus-housing.test.crt|.key (KAFKA_SSL=1: CA key persisted for kafka-ssl-from-dev-root)"
  else
    ok "certs/dev-root.pem, certs/off-campus-housing.test.crt|.key updated"
  fi

  # Step 4b: API is often overloaded right after step 2 (many secret creates). Wait for it to respond before Caddy rollout.
  # On k3d use shorter default so we don't wait 4 min (feels like a hang); override REISSUE_SETTLE_CAP if needed.
  _settle_default=240
  [[ "$ctx" == *"k3d"* ]] && _settle_default=90
  _settle_cap="${REISSUE_SETTLE_CAP:-$_settle_default}"
  _settle_n=$(( _settle_cap / 10 ))
  log_progress "step 4b: waiting for API to settle after secret updates (up to ${_settle_cap}s)…"
  _api_ready=0
  for _w in $(seq 1 "$_settle_n"); do
    if kubectl --request-timeout=15s get ns off-campus-housing-tracker >/dev/null 2>&1; then
      _api_ready=1
      [[ $_w -gt 1 ]] && echo "  (4b) API ready after $((_w * 10))s"
      break
    fi
    [[ $((_w % 3)) -eq 0 ]] && echo "  (4b) waiting for API… $((_w * 10))s"
    [[ $_w -lt $_settle_n ]] && sleep 10
  done
  [[ $_api_ready -eq 0 ]] && warn "API still not responding after ${_settle_cap}s; step 5 may fail with 'apiserver not ready'."

  # Step 5: Restart Caddy and wait for pods Ready using only short GETs (no long-lived watch).
  # If deploy caddy-h3 does not exist (e.g. fresh cluster before preflight 3c2), skip so preflight can continue; 3c2 will apply Caddy later.
  if ! kubectl get deploy caddy-h3 -n "$NS_ING" --request-timeout=10s >/dev/null 2>&1; then
    log_progress "step 5: skipping (deploy caddy-h3 not found in $NS_ING; preflight will apply Caddy in 3c2)"
    say "5. Restarting Caddy…"
    warn "Caddy deploy not found in ingress-nginx; skipping rollout (preflight applies Caddy in step 3c2)."
  else
  # rollout status / kubectl wait use watches that drop when API is flaky (connection reset, apiserver not ready).
  # Poll get pods every 10s for up to 5 min so we never depend on a stable long connection.
  CADDY_POLL_INTERVAL="${CADDY_POLL_INTERVAL:-10}"
  CADDY_POLL_MAX="${CADDY_POLL_MAX:-30}"
  log_progress "step 5: restarting Caddy (poll pods every ${CADDY_POLL_INTERVAL}s, max ${CADDY_POLL_MAX} polls)…"
  say "5. Restarting Caddy…"
  _k5() { kubectl --request-timeout=30s -n "$NS_ING" "$@"; }
  _caddy_ok=0
  TS="$(date +%Y-%m-%dT%H:%M:%SZ)"
  _caddy_patch_ok=0
  for _patch_try in 1 2; do
    if _k5 patch deploy caddy-h3 -p="{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\"$TS\"}}}}}" 2>/dev/null; then
      _caddy_patch_ok=1
      break
    fi
    [[ $_patch_try -eq 1 ]] && { warn "Caddy patch failed (API may still be settling); retrying in 30s…"; sleep 30; }
  done
  [[ $_caddy_patch_ok -eq 0 ]] && warn "Caddy patch failed twice; continuing to poll pods (rollout may already be in progress)."
  # Deployment has replicas: 2; during rollout maxSurge can add 1 extra, so we may see 3–4 pods. Success = ready >= desired (2), not ready == total.
  _desired=$(_k5 get deploy caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "2")
  _desired=$(( 0 + $(echo "$_desired" | head -1 | tr -d '\n') ))
  [[ "$_desired" -le 0 ]] && _desired=2
  for _poll in $(seq 1 "$CADDY_POLL_MAX"); do
    [[ $_poll -gt 1 ]] && sleep "$CADDY_POLL_INTERVAL"
    _ready=$(_k5 get pods -l app=caddy-h3 -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | tr ' ' '\n' | grep -c "True" || echo "0")
    _total=$(_k5 get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | wc -w | tr -d ' \n')
    _ready=$(( 0 + $(echo "$_ready" | head -1 | tr -d '\n') ))
    _total=$(( 0 + $(echo "$_total" | head -1 | tr -d '\n') ))
    if [[ "$_total" -gt 0 ]]; then
      # When goal met, show ready/desired so we don't display "2/3 ready (desired: 2)" (maxSurge can add a third pod)
      if [[ "$_ready" -ge "$_desired" ]] && [[ "$_desired" -gt 0 ]]; then
        echo "  [poll $_poll/$CADDY_POLL_MAX] Caddy pods: $_ready/$_desired ready"
      else
        echo "  [poll $_poll/$CADDY_POLL_MAX] Caddy pods: $_ready/$_total ready (desired: $_desired)"
      fi
    else
      echo "  [poll $_poll/$CADDY_POLL_MAX] Caddy pods: 0 ready (desired: $_desired)"
    fi
    if [[ "$_ready" -eq 0 ]] && [[ "$_poll" -eq 6 ]]; then
      echo "  (Still 0 ready? Check: kubectl -n ingress-nginx get pods -l app=caddy-h3 -o wide)"
    fi
    if [[ "$_ready" -ge "$_desired" ]] && [[ "$_desired" -gt 0 ]]; then
      _caddy_ok=1
      break
    fi
  done
  if [[ $_caddy_ok -eq 0 ]]; then
    echo "" >&2
    echo "❌ Caddy rollout failed. Run these to diagnose:" >&2
    echo "  kubectl -n ingress-nginx get pods -l app=caddy-h3 -o wide" >&2
    echo "  kubectl -n ingress-nginx describe deploy caddy-h3" >&2
    echo "  kubectl -n ingress-nginx get events --sort-by=.lastTimestamp | tail -20" >&2
    echo "--- Caddy pods ---" >&2
    _diag_out="$(_k5 get pods -l app=caddy-h3 -o wide 2>&1)" || true
    echo "$_diag_out" >&2
    if echo "$_diag_out" | grep -q "ServiceUnavailable\|apiserver not ready\|unable to handle"; then
      echo "  (API was overloaded after step 2. Wait 1–2 min, then run the commands above manually; Caddy may already be Running.)" >&2
    fi
    echo "--- Deployment (tail) ---" >&2
    _k5 describe deploy caddy-h3 2>&1 | tail -35 >&2 || true
    echo "--- Recent events ---" >&2
    _k5 get events --sort-by='.lastTimestamp' 2>&1 | tail -15 >&2 || true
    echo "" >&2
    warn "Caddy rollout failed. Fix (see above), then: kubectl -n ingress-nginx rollout restart deploy/caddy-h3 ; re-run reissue if needed."
    exit 1
  fi
  ok "Caddy rollout ready"
  # Scale down any stale ReplicaSet so we don't keep 3 pods (maxSurge during rollout leaves old RS with 1 pod until it scales).
  _desired_img=$(_k5 get deploy caddy-h3 -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
  if [[ -n "$_desired_img" ]]; then
    for _rs in $(_k5 get rs -l app=caddy-h3 -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null); do
      _img=$(_k5 get rs "$_rs" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
      _replicas=$(_k5 get rs "$_rs" -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
      if [[ -n "$_img" ]] && [[ "$_img" != "$_desired_img" ]] && [[ "${_replicas:-0}" -gt 0 ]]; then
        _k5 scale rs "$_rs" --replicas=0 2>/dev/null || true
      fi
    done
  fi
  fi

  if [[ "$RESTART_SERVICES" == "1" ]]; then
    log_progress "step 6: ensuring service-tls secret is ready before restarting..."
    # Proactive: Wait for service-tls secret to be fully available before restarting
    say "6. Ensuring service-tls secret is ready..."
    SECRET_READY=0
    for i in {1..15}; do
      if kctl -n "$NS_APP" get secret service-tls --request-timeout=5s >/dev/null 2>&1; then
        # Verify secret has data
        if kctl -n "$NS_APP" get secret service-tls -o jsonpath='{.data}' 2>/dev/null | grep -q "tls.crt"; then
          ok "service-tls secret is ready"
          SECRET_READY=1
          break
        fi
      fi
      if [[ $i -lt 15 ]]; then
        sleep 1
      fi
    done
    if [[ $SECRET_READY -eq 0 ]]; then
      warn "service-tls secret not fully ready after 15s, but continuing with restarts..."
    fi
    
    log_progress "step 7: restarting service deployments (sequential ordered rollout)…"
    say "7. Restarting service deployments (sequential order; pick up new service-tls)…"
    # Only restart deployments that exist (preflight may not have applied them yet — 3c/4 apply and scale come after reissue).
    # kctl uses host kubectl or colima VM kubectl (step 0c) — same as step 2.
    och_kubectl() { kctl "$@"; }
    # shellcheck source=scripts/lib/och-sequential-rollout.sh
    source "$SCRIPT_DIR/lib/och-sequential-rollout.sh"
    OCH_ROLLOUT_NS="$NS_APP" NS_ING="$NS_ING" och_rollout_ordered_housing_apps
    unset -f och_kubectl 2>/dev/null || true
    if kctl get deploy envoy-test -n envoy-test --request-timeout=5s >/dev/null 2>&1; then
      if [[ "$_use_vm_restart" == "1" ]]; then
        colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n envoy-test rollout restart deploy/envoy-test --request-timeout=30s 2>/dev/null && ok "envoy-test restarted" || true
      else
        kctl -n envoy-test rollout restart deploy/envoy-test 2>/dev/null && ok "envoy-test restarted" || true
      fi
    fi
    ok "Service restarts triggered"
  else
    log_progress "step 6: skipped (RESTART_SERVICES=0)"
    say "6. Skipping service restarts (RESTART_SERVICES=0)"
  fi

  say "=== Re-issue complete ==="
  ok "CA and leaf re-issued and loaded. Caddy and services use matching certs."
  echo "  Run tests again; curl exit 60 (CA/Caddy mismatch) should be resolved."
}

if [[ -n "${REISSUE_CAP:-}" ]] && [[ "${REISSUE_CAP}" -gt 0 ]] 2>/dev/null; then
  retfile=$(mktemp 2>/dev/null) || retfile="/tmp/reissue-ret-$$"
  ( _reissue_main; echo $? > "$retfile" ) & mpid=$!
  ( sleep "$REISSUE_CAP"; kill -9 $mpid 2>/dev/null ) & kpid=$!
  wait $mpid 2>/dev/null || true
  kill $kpid 2>/dev/null || true
  wait $kpid 2>/dev/null || true
  r=$(cat "$retfile" 2>/dev/null || echo "1")
  rm -f "$retfile"
  if [[ "$r" != "0" ]]; then
    warn "Reissue hit REISSUE_CAP=${REISSUE_CAP}s or failed. Check [reissue] step logs above."
    exit 1
  fi
  exit 0
fi
_reissue_main
