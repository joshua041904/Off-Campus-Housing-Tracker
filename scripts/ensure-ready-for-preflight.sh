#!/usr/bin/env bash
# Get to a known-good state so run-preflight-scale-and-all-suites.sh can run.
# 1) See what's going on (cross-layer diagnostic)
# 2) Ensure curl with HTTP/3 (optional)
# 3) Ensure Kubernetes API (k3d or Colima)
# 4) Ensure Redis + all 8 Postgres DBs (5441–5448)
# 5) Ensure Kafka (in-cluster KRaft)
# 6) k3d only: Ensure required app images (:dev) exist locally and in registry (so pods don't ImagePullBackOff). ENSURE_IMAGES=0 to skip.
#
# Usage:
#   ./scripts/ensure-ready-for-preflight.sh              # diagnose + ensure, then print "run preflight"
#   ./scripts/ensure-ready-for-preflight.sh --run         # same then run preflight
#   SKIP_DIAGNOSTIC=1 ./scripts/ensure-ready-for-preflight.sh   # skip diagnostic (faster)
#
# See: scripts/run-preflight-scale-and-all-suites.sh, docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RUN_PREFLIGHT="${RUN_PREFLIGHT:-0}"
[[ "${1:-}" == "--run" ]] && RUN_PREFLIGHT=1
SKIP_DIAGNOSTIC="${SKIP_DIAGNOSTIC:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# --- 1. Cross-layer diagnostic (see what's really going on) ---
if [[ "$SKIP_DIAGNOSTIC" != "1" ]] && [[ -x "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" ]]; then
  say "1. Cross-layer diagnostic (Colima, API, k3s, pods, MetalLB, storage)..."
  "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" 2>&1 || true
else
  if [[ "$SKIP_DIAGNOSTIC" == "1" ]]; then
    say "1. Skipping diagnostic (SKIP_DIAGNOSTIC=1)"
  else
    say "1. Diagnostic script not found or not executable; continuing."
  fi
fi

# --- 2. Ensure curl with HTTP/3 (for MetalLB/ingress verification) ---
say "2. Ensuring curl with HTTP/3 support..."
if command -v brew >/dev/null 2>&1; then
  brew upgrade curl 2>/dev/null || true
  if [[ -x /opt/homebrew/opt/curl/bin/curl ]] && /opt/homebrew/opt/curl/bin/curl --help 2>/dev/null | grep -q -- "--http3"; then
    ok "Homebrew curl with HTTP/3 available (/opt/homebrew/opt/curl/bin/curl)"
  else
    warn "Homebrew curl without HTTP/3; MetalLB HTTP/3 verification may fail (brew install curl --with-nghttp2)"
  fi
else
  info "Homebrew not found; using system curl (HTTP/3 tests may fail)"
fi

# --- 3. Ensure Kubernetes API (k3d or Colima) ---
say "3. Ensuring Kubernetes API..."
ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
  k3d kubeconfig merge "${ctx#k3d-}" --kubeconfig-merge-default 2>/dev/null || true
  if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
    _ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2=="Ready" {c++} END {print c+0}')
    _total=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$_total" -ge 2 ]] && [[ "$_ready" -eq "$_total" ]]; then
      ok "API reachable (k3d); cluster healthy: $_ready/$_total nodes Ready"
    elif [[ "$_ready" -gt 0 ]]; then
      ok "API reachable (k3d); nodes $_ready/$_total Ready (expected 2 for full preflight)"
    else
      warn "k3d API reachable but no nodes Ready. Wait for: kubectl get nodes"
      exit 1
    fi
    # Brief pod summary so user sees cluster state
    _pods_not_ready=$(kubectl get pods -n off-campus-housing-tracker --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l | tr -d ' ' || echo "?")
    _pods_total=$(kubectl get pods -n off-campus-housing-tracker --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    [[ "$_pods_total" -gt 0 ]] && echo "  off-campus-housing-tracker pods: $_pods_total total ($_pods_not_ready not Running/Completed)"
  else
    warn "k3d API not reachable. Run: k3d cluster start (or create cluster), then kubectl get nodes"
    exit 1
  fi
elif [[ -x "$SCRIPT_DIR/ensure-k8s-api.sh" ]]; then
  if "$SCRIPT_DIR/ensure-k8s-api.sh"; then
    ok "API reachable"
  else
    warn "API not reachable. Start Colima: colima start --with-kubernetes"
    warn "Then: ./scripts/colima-forward-6443.sh  and re-run this script."
    exit 1
  fi
else
  if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    ok "API reachable (ensure-k8s-api.sh not used)"
  else
    warn "ensure-k8s-api.sh not found and kubectl get nodes failed."
    exit 1
  fi
fi

# --- 4. Ensure external infra (Redis, then all 8 Postgres) ---
REDIS_PORT="${REDIS_PORT:-6380}"
say "4. Ensuring Redis ($REDIS_PORT) and Postgres (5441–5448)..."
if ! nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
  if [[ -f "$SCRIPT_DIR/bring-up-external-infra.sh" ]]; then
    info "Redis not reachable; bringing up external infra (Redis, 8 Postgres)..."
    "$SCRIPT_DIR/bring-up-external-infra.sh" 2>&1 || true
  fi
  if ! nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
    warn "Redis ($REDIS_PORT) not reachable. Run: ./scripts/bring-up-external-infra.sh  or docker compose up -d redis"
    exit 1
  fi
fi
ok "Redis reachable ($REDIS_PORT)"
if [[ -x "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh" ]]; then
  if "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh"; then
    ok "All 8 Postgres DBs reachable (5441–5448)"
  else
    warn "Not all DBs ready. Run: ./scripts/bring-up-external-infra.sh  or docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media"
    exit 1
  fi
else
  _pg_up=0
  for _p in 5441 5442 5443 5444 5445 5446 5447 5448; do
    nc -z 127.0.0.1 "$_p" 2>/dev/null && _pg_up=$((_pg_up + 1)) || true
  done
  if [[ "$_pg_up" -eq 8 ]]; then
    ok "All 8 Postgres ports reachable (5441–5448)"
  else
    warn "Postgres ports: $_pg_up/8 up (expected 5441–5448). Run: ./scripts/bring-up-external-infra.sh"
    exit 1
  fi
fi

_KNS="${HOUSING_NS:-off-campus-housing-tracker}"
# --- 5. Ensure Kafka (in-cluster KRaft; Compose broker removed) ---
say "5. Ensuring Kafka (k8s $_KNS)..."
if command -v kubectl >/dev/null 2>&1 && kubectl get pod kafka-0 -n "$_KNS" &>/dev/null; then
  for _i in 0 1 2; do
    kubectl wait pod "kafka-${_i}" -n "$_KNS" --for=condition=Ready --timeout=120s 2>/dev/null && ok "kafka-${_i} Ready" || warn "kafka-${_i} not Ready (continue)"
  done
else
  warn "kafka-0 not in $_KNS — deploy KRaft StatefulSet or skip until cluster Kafka exists"
fi

# --- 5b. Colima: host aliases so pods reach Postgres/Redis (get to 1/1 Ready) ---
if [[ "$ctx" == *"colima"* ]] && [[ -x "$SCRIPT_DIR/colima-apply-host-aliases.sh" ]]; then
  say "5b. Colima: ensuring host.docker.internal resolves so pods can reach Postgres/Redis..."
  if "$SCRIPT_DIR/colima-apply-host-aliases.sh" 2>&1; then
    ok "Host aliases applied (pods will roll out with correct host.docker.internal)"
  else
    warn "colima-apply-host-aliases.sh failed or not Colima; pods may stay 0/1 if host IP is wrong"
  fi
fi

# --- 6. Ensure required app images (k3d: must be in registry so pods don't ImagePullBackOff) ---
# Set ENSURE_IMAGES=0 to skip. When k3d: check local :dev images and optionally registry catalog.
REQUIRED_APP_IMAGES=( api-gateway auth-service listings-service booking-service messaging-service trust-service analytics-service media-service )
ENSURE_IMAGES="${ENSURE_IMAGES:-1}"
if [[ "$ENSURE_IMAGES" == "1" ]] && [[ "$ctx" == *"k3d"* ]] && command -v docker >/dev/null 2>&1; then
  say "6. Ensuring required app images (local :dev and k3d registry)..."
  REG="${K3D_REGISTRY:-k3d-off-campus-housing-tracker-registry:5000}"
  _missing=()
  _present=()
  for s in "${REQUIRED_APP_IMAGES[@]}"; do
    if docker image inspect "$s:dev" >/dev/null 2>&1; then
      _present+=("$s")
    else
      _missing+=("$s")
    fi
  done
  if [[ ${#_missing[@]} -gt 0 ]]; then
    warn "Missing local image(s): ${_missing[*]}"
    echo "  Build: ./scripts/build-dev-images-for-k3d.sh  then push: ./scripts/k3d-registry-push-and-patch.sh"
    echo "  Or build one: docker build -t <name>:dev -f services/<name>/Dockerfile .  then ./scripts/k3d-registry-push-and-patch.sh"
    echo "  Then: kubectl rollout restart deploy -n off-campus-housing-tracker"
    exit 1
  fi
  ok "All ${#_present[@]} app images present locally (:dev)"
  # Check registry is reachable and has the images (so cluster can pull)
  if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:5000/v2/" 2>/dev/null | grep -qE '200|401'; then
    _reg_missing=()
    for s in "${REQUIRED_APP_IMAGES[@]}"; do
      _code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:5000/v2/$s/tags/list" 2>/dev/null || echo "000")
      if [[ "$_code" != "200" ]]; then
        _reg_missing+=("$s")
      fi
    done
    if [[ ${#_reg_missing[@]} -gt 0 ]]; then
      warn "Registry (127.0.0.1:5000) missing image(s): ${_reg_missing[*]}"
      echo "  Push existing :dev images: ./scripts/k3d-registry-push-and-patch.sh"
      echo "  (Requires: 127.0.0.1 k3d-off-campus-housing-tracker-registry in /etc/hosts and registry in Docker insecure-registries)"
      exit 1
    fi
    ok "All ${#REQUIRED_APP_IMAGES[@]} app images present in registry ($REG)"
  else
    warn "Registry (127.0.0.1:5000) not reachable; cannot verify images. Start k3d cluster and registry, then run: ./scripts/k3d-registry-push-and-patch.sh"
    echo "  Continuing; preflight may hit ImagePullBackOff. Push images: ./scripts/k3d-registry-push-and-patch.sh"
  fi
elif [[ "$ENSURE_IMAGES" == "1" ]] && [[ "$ctx" != *"k3d"* ]]; then
  say "6. Skipping app image check (not k3d context)"
elif [[ "$ENSURE_IMAGES" == "0" ]]; then
  say "6. Skipping app image check (ENSURE_IMAGES=0)"
fi

say "Ready for preflight"
echo "  Run: ./scripts/run-preflight-scale-and-all-suites.sh"
echo "  Or:  RUN_FULL_LOAD=0 for suites only (no pgbench/k6)."
echo "  Layers: API (6443) → kubeconfig → reissue → scale → pods → wait → suites."
echo "  Tuning: ENFORCE_DB_TUNING=1 ./scripts/bring-up-external-infra.sh or ./scripts/enforce-external-db-schemas-and-tuning.sh — see docs/BACKUPS_AND_TUNING.md"
if [[ "$RUN_PREFLIGHT" == "1" ]]; then
  say "Running preflight (--run)..."
  exec "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"
fi
exit 0
