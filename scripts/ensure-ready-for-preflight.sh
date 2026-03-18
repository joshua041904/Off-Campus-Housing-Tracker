#!/usr/bin/env bash
# Get to a known-good state so run-preflight-scale-and-all-suites.sh can run.
# 1) See what's going on (cross-layer diagnostic)
# 2) Ensure curl with HTTP/3 (optional)
# 3) Ensure Kubernetes API (k3d or Colima)
# 4) Ensure Redis + all 8 Postgres DBs (5433–5440)
# 5) Ensure Kafka (Docker :29093)
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
    _pods_not_ready=$(kubectl get pods -n record-platform --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l | tr -d ' ' || echo "?")
    _pods_total=$(kubectl get pods -n record-platform --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    [[ "$_pods_total" -gt 0 ]] && echo "  record-platform pods: $_pods_total total ($_pods_not_ready not Running/Completed)"
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
say "4. Ensuring Redis (6379) and Postgres (5433–5440)..."
if ! nc -z 127.0.0.1 6379 2>/dev/null; then
  if [[ -f "$SCRIPT_DIR/bring-up-external-infra.sh" ]]; then
    info "Redis not reachable; bringing up external infra (Redis, Kafka, 8 Postgres)..."
    "$SCRIPT_DIR/bring-up-external-infra.sh" 2>&1 || true
  fi
  if ! nc -z 127.0.0.1 6379 2>/dev/null; then
    warn "Redis (6379) not reachable. Run: ./scripts/bring-up-external-infra.sh  or docker compose up -d redis"
    exit 1
  fi
fi
ok "Redis reachable (6379)"
if [[ -x "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh" ]]; then
  if "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh"; then
    ok "All 8 Postgres DBs reachable (5433–5440)"
  else
    warn "Not all DBs ready. Run: ./scripts/bring-up-external-infra.sh  or docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai"
    exit 1
  fi
else
  warn "ensure-pgbench-dbs-ready.sh not found; skipping DB check."
fi

# --- 5. Ensure Kafka (Docker :29093 for strict TLS) ---
say "5. Ensuring Kafka (Docker :29093)..."
if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
  ( cd "$REPO_ROOT" && docker compose up -d zookeeper kafka 2>/dev/null ) || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if nc -z 127.0.0.1 29093 2>/dev/null; then
      ok "Kafka reachable (port 29093)"
      break
    fi
    [[ $i -eq 10 ]] && warn "Kafka port 29093 not reachable after 20s (preflight will start it again)"
    sleep 2
  done
else
  warn "Docker or docker-compose not available; skipping Kafka."
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
REQUIRED_APP_IMAGES=( api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor )
ENSURE_IMAGES="${ENSURE_IMAGES:-1}"
if [[ "$ENSURE_IMAGES" == "1" ]] && [[ "$ctx" == *"k3d"* ]] && command -v docker >/dev/null 2>&1; then
  say "6. Ensuring required app images (local :dev and k3d registry)..."
  REG="${K3D_REGISTRY:-k3d-record-platform-registry:5000}"
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
    echo "  Then: kubectl rollout restart deploy -n record-platform"
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
      echo "  (Requires: 127.0.0.1 k3d-record-platform-registry in /etc/hosts and registry in Docker insecure-registries)"
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
