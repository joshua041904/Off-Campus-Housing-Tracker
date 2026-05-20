#!/usr/bin/env bash
# Canonical dev deploy: k3s up → namespace → secrets → ConfigMap → manifests → wait readiness → smoke test.
# External infra (Postgres 5441–5448, Redis) must be up; in-cluster Kafka (KRaft) should be applied and ready. Run bootstrap-all-dbs.sh or restore as needed.
#
# Usage: ./scripts/deploy-dev.sh
#   SKIP_SMOKE=1           — do not run smoke test after deploy
#   SKIP_K6=1              — do not run k6 after smoke
#   SKIP_STRICT_ENVELOPE=1 — skip lab vs strict-envelope.json check (unsafe for prod)
#   DEPLOY_OVERLAY=        — kustomize overlay (default: overlays/dev)
#   DEPLOY_SKIP_SMART_IMAGE_ROLLOUT=1 — skip smart-rollout-housing-if-image-changed.sh (same-tag new digest)
#   DEPLOY_KUSTOMIZE_DIFF_PREVIEW=1 — run kubectl diff (manifest vs live) before apply; exit ≥2 fails the script
#   VERIFY_MANIFEST_LABEL — label for verify-kustomize messages when streaming (default: overlay path tail)
#   DEPLOY_KUBECTL_SERVER_SIDE_APPLY=1 — add --server-side --field-manager=och-deploy-dev to kubectl apply
#   DEPLOY_KUBECTL_APPLY_VALIDATE=strict|warn — pass --validate=… to kubectl apply (kubectl version dependent)
#   DEPLOY_KUBECTL_APPLY_VERBOSE=N — kubectl --v=N (e.g. 6) on apply for API tracing
#   DEPLOY_KUBECTL_APPLY_ISOLATE=1 — apply multi-doc YAML one document at a time (scripts/kubectl-apply-yaml-stream-split.py)
#   ROLLOUT_TIMEOUT_API_GATEWAY — kubectl duration for api-gateway only (default 600s; /readyz waits for auth gRPC)
#   ROLLOUT_TIMEOUT_BACKENDS — duration for each backend Deployment (default 300s)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# 1) k3s / context
if ! kubectl config current-context &>/dev/null; then
  warn "No kube context. Start k3s/Colima and ensure kubectl points at the cluster."
  exit 1
fi
ok "Context: $(kubectl config current-context)"

# 2) Namespace(s)
NS="${NAMESPACE:-off-campus-housing-tracker}"
for n in "$NS" ingress-nginx envoy-test; do
  kubectl create namespace "$n" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
done
ok "Namespaces present"

# 3) Secrets (must exist; create via strict-tls-bootstrap / rotate-ca etc.)
if ! kubectl get secret -n "$NS" app-secrets &>/dev/null 2>&1; then
  warn "app-secrets not found in $NS. Create TLS/secrets first (e.g. scripts/strict-tls-bootstrap.sh)."
fi
LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-off-campus-housing-local-tls}"
if ! kubectl get secret -n ingress-nginx "$LEAF_TLS_SECRET" &>/dev/null 2>&1 || ! kubectl get secret -n ingress-nginx dev-root-ca &>/dev/null 2>&1; then
  warn "Caddy TLS secrets ($LEAF_TLS_SECRET, dev-root-ca) missing in ingress-nginx. Run scripts/rollout-caddy.sh after creating secrets."
fi

# 4) ConfigMap (canonical DATABASE_HOST + ports)
KUST_DIR="$REPO_ROOT/infra/k8s"
if [[ -d "$KUST_DIR/base/config" ]]; then
  kubectl apply -f "$KUST_DIR/base/config/app-config.yaml" -n "$NS" 2>/dev/null || true
  ok "ConfigMap app-config applied"
fi

# 4b) Strict envelope — lab recommendations must not exceed declared pools / ingress stream caps
if [[ "${SKIP_STRICT_ENVELOPE:-0}" != "1" ]] && command -v node &>/dev/null; then
  say "Strict envelope check (capacity-recommendations vs infra/k8s/base/config/strict-envelope.json)..."
  if ! node "$REPO_ROOT/scripts/protocol/strict-envelope-check.js" --perf-dir "$REPO_ROOT/bench_logs/performance-lab"; then
    warn "Failed. Refresh strict-envelope.json and cluster pools, run make capacity-one, or set SKIP_STRICT_ENVELOPE=1 (not for production)."
    exit 1
  fi
  ok "Strict envelope OK"
fi

# 5) Apply manifests (kustomize or raw) — single in-memory build, stream apply (no mktemp / no disk manifest)
DEPLOY_OVERLAY="${DEPLOY_OVERLAY:-overlays/dev}"
REQUIRED_HOUSING_DEPLOYS=(
  api-gateway auth-service listings-service booking-service messaging-service
  trust-service analytics-service media-service notification-service
)

_och_kustomize_build_stream() {
  local od="$1"
  if command -v kustomize &>/dev/null 2>&1; then
    kustomize build "$od"
  else
    kubectl kustomize "$od"
  fi
}

# kubectl apply … tail (everything after the word "kubectl") for streaming stdin YAML.
_och_deploy_kubectl_apply_tail() {
  _kubectl_apply_tail=(apply -f - --request-timeout=180s)
  if [[ "${DEPLOY_KUBECTL_APPLY_VERBOSE:-0}" != "0" ]]; then
    _kubectl_apply_tail+=(--v="${DEPLOY_KUBECTL_APPLY_VERBOSE}")
  fi
  if [[ "${DEPLOY_KUBECTL_SERVER_SIDE_APPLY:-0}" == "1" ]]; then
    _kubectl_apply_tail+=(--server-side --field-manager=och-deploy-dev)
  fi
  case "${DEPLOY_KUBECTL_APPLY_VALIDATE:-}" in
    strict) _kubectl_apply_tail+=(--validate=strict) ;;
    warn) _kubectl_apply_tail+=(--validate=warn) ;;
  esac
}

# Stream MANIFEST on stdin to kubectl apply; tee full combined stdout+stderr to bench_logs; never hide errors.
_och_kubectl_apply_manifest_logged() {
  local manifest="$1"
  local logf="$REPO_ROOT/bench_logs/last-kubectl-apply.log"
  mkdir -p "$REPO_ROOT/bench_logs"
  _och_deploy_kubectl_apply_tail
  local _rc
  if [[ "${DEPLOY_KUBECTL_APPLY_ISOLATE:-0}" == "1" ]]; then
    say "kubectl apply (isolated: one YAML document at a time — DEPLOY_KUBECTL_APPLY_ISOLATE=1)…"
    set +e
    _apply_blob="$(printf '%s' "$manifest" | python3 "$SCRIPT_DIR/kubectl-apply-yaml-stream-split.py" "${_kubectl_apply_tail[@]}" 2>&1)"
    _rc=$?
    set -e
    printf '%s\n' "$_apply_blob" | tee "$logf"
    if [[ "$_rc" -ne 0 ]]; then
      warn "kubectl apply failed (exit $_rc). Full output is above and in $logf"
      exit 1
    fi
    return 0
  fi

  say "kubectl apply (streaming; full log → $logf)…"
  set +e
  set +o pipefail
  printf '%s' "$manifest" | kubectl "${_kubectl_apply_tail[@]}" 2>&1 | tee "$logf"
  _rc=0
  [[ "${PIPESTATUS[1]:-0}" -ne 0 ]] && _rc=${PIPESTATUS[1]}
  [[ "${PIPESTATUS[2]:-0}" -ne 0 ]] && _rc=${PIPESTATUS[2]}
  set -o pipefail
  set -e
  if [[ "$_rc" -ne 0 ]]; then
    warn "kubectl apply failed (exit $_rc). Full output is above and in $logf"
    exit 1
  fi
}

if [[ -d "$KUST_DIR/$DEPLOY_OVERLAY" ]]; then
  say "Kustomize $DEPLOY_OVERLAY — build (memory) → validate core Deployments → apply (stream)…"
  _od_abs="$KUST_DIR/$DEPLOY_OVERLAY"
  if ! MANIFEST="$(_och_kustomize_build_stream "$_od_abs")"; then
    warn "kustomize build failed for $_od_abs"
    exit 1
  fi
  if [[ -z "${MANIFEST//[$' \t\n\r']/}" ]]; then
    warn "kustomize produced empty output for $_od_abs"
    exit 1
  fi

  export VERIFY_MANIFEST_LABEL="${VERIFY_MANIFEST_LABEL:-$DEPLOY_OVERLAY}"
  if ! printf '%s' "$MANIFEST" | bash "$SCRIPT_DIR/verify-kustomize-overlay-core-deployments.sh" --from-stdin; then
    exit 1
  fi

  if [[ "${DEPLOY_KUSTOMIZE_DIFF_PREVIEW:-0}" == "1" ]]; then
    say "kubectl diff — live cluster vs manifest (exit 1 = diff present; ≥2 = error)…"
    set +e
    _diff_out="$(printf '%s' "$MANIFEST" | kubectl diff -f - 2>&1)"
    _diff_rc=$?
    set -e
    if [[ "$_diff_rc" -ge 2 ]]; then
      echo "$_diff_out" >&2
      warn "kubectl diff failed (rc=$_diff_rc)"
      exit 1
    fi
    if [[ "$_diff_rc" -eq 1 ]]; then
      echo "$_diff_out" | head -400
      ok "kubectl diff: changes vs cluster (preview only)"
    else
      info "kubectl diff: no changes vs cluster"
    fi
  fi

  _och_kubectl_apply_manifest_logged "$MANIFEST"

  mkdir -p "$REPO_ROOT/bench_logs"
  _manifest_sha="$(printf '%s' "$MANIFEST" | if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | awk '{print $1}')"
  printf '%s\n' "$_manifest_sha" >"$REPO_ROOT/bench_logs/last-deployed-kustomize-manifest.sha256"
  printf '{"overlay":"%s","sha256":"%s","ts":"%s"}\n' "$DEPLOY_OVERLAY" "$_manifest_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$REPO_ROOT/bench_logs/last-deployed-kustomize-manifest.json"
  ok "Recorded manifest checksum → bench_logs/last-deployed-kustomize-manifest.{sha256,json}"
  unset VERIFY_MANIFEST_LABEL

  say "Reconciling missing housing Deployments (per-app base bundles if overlay reconcile lagged)…"
  for dep in "${REQUIRED_HOUSING_DEPLOYS[@]}"; do
    if ! kubectl get "deployment/$dep" -n "$NS" --request-timeout=15s &>/dev/null; then
      warn "deployment/$dep missing in $NS — applying kustomize base/$dep"
      if [[ ! -d "$KUST_DIR/base/$dep" ]]; then
        warn "No bundle at $KUST_DIR/base/$dep — cannot reconcile."
        exit 1
      fi
      set +e
      _rout="$(kubectl apply -k "$KUST_DIR/base/$dep" --request-timeout=120s 2>&1)"
      _rrc=$?
      set -e
      if [[ "$_rrc" -ne 0 ]]; then
        warn "kubectl apply -k base/$dep failed (exit $_rrc):"
        printf '%s\n' "$_rout" >&2
        exit 1
      fi
    fi
  done
else
  info "No kustomize overlay at $KUST_DIR/$DEPLOY_OVERLAY — applying core base bundles only."
  if [[ -d "$KUST_DIR/base" ]]; then
    for d in config api-gateway auth-service listings-service booking-service messaging-service trust-service analytics-service media-service notification-service; do
      if [[ -d "$KUST_DIR/base/$d" ]]; then
        set +e
        _rout="$(kubectl apply -k "$KUST_DIR/base/$d" -n "$NS" --request-timeout=120s 2>&1)"
        _rrc=$?
        set -e
        if [[ "$_rrc" -ne 0 ]]; then
          warn "kubectl apply -k base/$d failed (exit $_rrc):"
          printf '%s\n' "$_rout" >&2
          exit 1
        fi
      fi
    done
  fi
fi

if [[ "${DEPLOY_SKIP_SMART_IMAGE_ROLLOUT:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/smart-rollout-housing-if-image-changed.sh" ]]; then
  say "Smart rollout — restart Deployments only when host Docker :dev digest ≠ pod imageID…"
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/smart-rollout-housing-if-image-changed.sh"
fi

# 5b) Kafka KRaft — wait for StatefulSet only after it exists (same ordering as preflight / cold start)
if kubectl get sts kafka -n "$NS" &>/dev/null 2>&1; then
  say "Waiting for StatefulSet/kafka rollout…"
  kubectl rollout status statefulset/kafka -n "$NS" --timeout=480s 2>/dev/null || warn "kafka rollout did not complete within timeout"
  ok "Kafka StatefulSet rollout observed"
  if [[ "${DEPLOY_SKIP_KAFKA_READY_GATE:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/verify-kafka-ready.sh" ]]; then
    chmod +x "$SCRIPT_DIR/verify-kafka-ready.sh" 2>/dev/null || true
    HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" bash "$SCRIPT_DIR/verify-kafka-ready.sh" \
      || { echo "verify-kafka-ready failed — set DEPLOY_SKIP_KAFKA_READY_GATE=1 to bypass (not recommended)" >&2; exit 1; }
    ok "Kafka readiness gate (verify-kafka-ready.sh)"
  fi
else
  info "StatefulSet kafka not present — skipping Kafka wait (apply KRaft bundle if needed)"
fi

# 6) Caddy + Envoy (if present)
[[ -f "$SCRIPT_DIR/rollout-caddy.sh" ]] && "$SCRIPT_DIR/rollout-caddy.sh" || true
kubectl rollout status deployment/envoy-test -n envoy-test --timeout=120s 2>/dev/null || true

# 7) Wait for deployments in app namespace
# api-gateway GET /readyz returns 503 until auth-service gRPC+mTLS health succeeds — never wait for
# api-gateway before auth (would wedge rollout / progressDeadline). Backends first, gateway last.
say "Waiting for deployments (readiness)..."
BE_TO="${ROLLOUT_TIMEOUT_BACKENDS:-300s}"
GW_TO="${ROLLOUT_TIMEOUT_API_GATEWAY:-600s}"
for dep in auth-service listings-service booking-service messaging-service trust-service analytics-service media-service notification-service; do
  if ! kubectl get deployment -n "$NS" "$dep" &>/dev/null 2>&1; then
    warn "deployment/$dep missing in $NS after kustomize apply — cluster will not serve traffic correctly."
    exit 1
  fi
  kubectl rollout status deployment/"$dep" -n "$NS" --timeout="$BE_TO"
  ok "$dep ready"
done
if ! kubectl get deployment -n "$NS" api-gateway &>/dev/null 2>&1; then
  warn "deployment/api-gateway missing in $NS after kustomize apply — cluster will not serve traffic correctly."
  exit 1
fi
kubectl rollout status deployment/api-gateway -n "$NS" --timeout="$GW_TO"
ok "api-gateway ready"

# 7b) Deployment Available ≠ Service Endpoints populated (kube-dns / kube-proxy lag on single-node k3s).
if [[ -f "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh" ]]; then
  say "Waiting for housing Service Endpoints (before smoke)…"
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh"
else
  warn "wait-for-housing-service-endpoints.sh missing — smoke may race internal DNS"
fi

# 8) Smoke test
if [[ "${SKIP_SMOKE:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/smoke-test-dev.sh" ]]; then
  say "Running smoke test..."
  "$SCRIPT_DIR/smoke-test-dev.sh" || warn "Smoke test had failures"
fi

# 9) Optional k6
if [[ "${SKIP_K6:-1}" != "1" ]] && [[ -f "$SCRIPT_DIR/load/run-k6-phases.sh" ]]; then
  export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
  if [[ -s "${K6_CA_ABSOLUTE:-}" ]]; then
    say "Running k6 (messaging phase)..."
    K6_PHASES=messaging "$SCRIPT_DIR/load/run-k6-phases.sh" || true
  fi
fi

ok "Deploy-dev complete."
