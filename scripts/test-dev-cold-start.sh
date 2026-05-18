#!/usr/bin/env bash
# Destructive cold-boot validation: reset local Colima/Docker/images/node_modules (optional certs), run `make dev`,
# assert cluster/TLS/Kafka/edge, run `make dev-verify`, run `make dev` again for idempotency, emit bench_logs artifacts.
#
# Prerequisites: Colima + Docker, Node ≥ 20, pnpm, kubectl, openssl, curl, python3. Primary path: macOS + Colima.
#
# SAFETY — Phase B destroys local Docker images and stops Colima/containers. Opt in:
#   COLD_START_CONFIRM=yes ./scripts/test-dev-cold-start.sh
#
# Env:
#   COLD_START_CONFIRM=yes     — required for Phase B
#   COLD_START_RESET_CERTS=1   — move repo certs/ to bench_logs/dev-cold-start-certs-backup-<epoch>
#   COLD_START_SKIP_PRUNE=1    — skip docker image prune -af
#   COLD_START_SKIP_NODE_CLEAN=1 — skip rm -rf node_modules
#   COLD_START_REQUIRE_HTTP3=1 — require curl --http3 /api/healthz returns HTTP version 3
#   COLD_START_ALLOW_NON_COLIMA=1 — skip colima stop; set REQUIRE_COLIMA=0 for make dev (k3d experiments)
#   OCH_EDGE_HOSTNAME          — default off-campus-housing.test
#   HOUSING_NS                 — default off-campus-housing-tracker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BENCH="${REPO_ROOT}/bench_logs"
PRE="${BENCH}/dev-cold-start-pre.txt"
POST="${BENCH}/dev-cold-start-post.txt"
METRICS="${BENCH}/dev-cold-start-metrics.json"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
EDGE_HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
CA_PEM="${REPO_ROOT}/certs/dev-root.pem"

mkdir -p "$BENCH"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
now_s() { date +%s; }

make() {
  command make -C "$REPO_ROOT" "$@"
}

snapshot_state() {
  local dest="$1"
  {
    echo "cold-start snapshot @ $(ts)"
    echo "uname: $(uname -a 2>/dev/null || true)"
    echo "pwd: $REPO_ROOT"
    echo ""
    echo "=== colima status ==="
    colima status 2>&1 || echo "(colima not installed or error)"
    echo ""
    echo "=== docker context ==="
    docker context show 2>&1 || true
    echo ""
    echo "=== docker ps -a (first 80 lines) ==="
    docker ps -a 2>&1 | head -80 || echo "(docker unavailable)"
    echo ""
    echo "=== docker images (first 40 lines) ==="
    docker images 2>&1 | head -40 || true
    echo ""
    echo "=== kubectl config current-context ==="
    kubectl config current-context 2>&1 || echo "(no kubectl context)"
    echo ""
    echo "=== kubectl get nodes ==="
    kubectl get nodes -o wide 2>&1 || echo "(kubectl cluster unreachable)"
    echo ""
    echo "=== kubectl get pods -n $HOUSING_NS (summary) ==="
    kubectl get pods -n "$HOUSING_NS" 2>&1 | head -60 || echo "(ns missing or unreachable)"
    echo ""
    echo "=== kubectl get secrets -n $HOUSING_NS (count) ==="
    kubectl get secrets -n "$HOUSING_NS" --no-headers 2>/dev/null | wc -l | awk '{print "secret_count", $1}' || echo "secrets: n/a"
    echo ""
    echo "=== node_modules (sample) ==="
    [[ -d "$REPO_ROOT/node_modules" ]] && echo "root node_modules: yes" || echo "root node_modules: no"
    echo ""
    echo "=== certs/dev-root.pem ==="
    [[ -f "$CA_PEM" ]] && openssl x509 -in "$CA_PEM" -noout -subject -dates 2>/dev/null || echo "missing dev-root.pem"
  } | tee "$dest"
}

stop_all_running_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  local ids
  ids="$(docker ps -q 2>/dev/null || true)"
  if [[ -n "${ids//$'\n'/}" ]]; then
    # shellcheck disable=SC2086
    docker stop $ids 2>/dev/null || true
  fi
}

compose_down_if_possible() {
  if [[ -f "$REPO_ROOT/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
    (cd "$REPO_ROOT" && docker compose down 2>/dev/null) || true
  fi
}

rm_workspace_node_modules() {
  [[ "${COLD_START_SKIP_NODE_CLEAN:-0}" == "1" ]] && return 0
  rm -rf "$REPO_ROOT/node_modules" \
    "$REPO_ROOT/webapp/node_modules" \
    "$REPO_ROOT/tools/kafka-contract/node_modules" 2>/dev/null || true
  local d
  for d in "$REPO_ROOT"/services/*/node_modules; do
    # After Colima/docker shutdown, nested deletes can still hit EBUSY; never fail Phase B on cleanup.
    [[ -d "$d" ]] && rm -rf "$d" 2>/dev/null || true
  done
}

rm_dist_artifacts() {
  local roots=() p
  for p in "$REPO_ROOT/services" "$REPO_ROOT/webapp" "$REPO_ROOT/tools"; do
    [[ -d "$p" ]] && roots+=("$p")
  done
  [[ ${#roots[@]} -eq 0 ]] && return 0
  find "${roots[@]}" -maxdepth 3 -type d -name dist 2>/dev/null | while read -r d; do
    [[ -n "$d" && "$d" == "$REPO_ROOT"* ]] && rm -rf "$d" 2>/dev/null || true
  done || true
}

require_colima_path() {
  [[ "${REQUIRE_COLIMA:-1}" == "1" ]]
}

assert_colima_running() {
  require_colima_path || return 0
  # Colima log output uses lowercase "running" in `colima is running`; `colima list` uses column "Running".
  if colima status 2>/dev/null | grep -qi 'colima is running'; then
    return 0
  fi
  if colima list 2>/dev/null | grep -Eq '^default[[:space:]]+Running\b'; then
    return 0
  fi
  bad "Colima is not Running"
  return 1
}

assert_docker_colima_context() {
  require_colima_path || return 0
  local ctx
  ctx="$(docker context show 2>/dev/null || true)"
  if [[ "$ctx" != *colima* ]]; then
    bad "docker context is '$ctx' (expected name containing 'colima')"
    return 1
  fi
  ok "docker context: $ctx"
}

export_kube_colima() {
  local _lib
  _lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/colima-kubeconfig.sh"
  if [[ -f "$_lib" ]]; then
    # shellcheck source=scripts/lib/colima-kubeconfig.sh
    source "$_lib"
    och_export_colima_kubeconfig_prefer_reachable || {
      local _k="${HOME}/.colima/default/kubernetes/kubeconfig"
      [[ -s "$_k" ]] || _k="${HOME}/.colima/default/kubeconfig"
      [[ -s "$_k" ]] && export KUBECONFIG="$_k"
    }
  elif [[ -s "${HOME}/.colima/default/kubernetes/kubeconfig" ]]; then
    export KUBECONFIG="${HOME}/.colima/default/kubernetes/kubeconfig"
  elif [[ -f "${HOME}/.colima/default/kubeconfig" ]]; then
    export KUBECONFIG="${HOME}/.colima/default/kubeconfig"
  fi
}

assert_kubectl_colima() {
  export_kube_colima
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ -z "$ctx" ]]; then
    bad "no kubectl current-context"
    return 1
  fi
  # Colima's embedded kubeconfig often uses context name "default" (k3s); only reject unrelated contexts.
  if require_colima_path && [[ "$ctx" != *colima* && "$ctx" != "default" ]]; then
    bad "kubectl context is '$ctx' (expected *colima* or default for Colima/k3s)"
    return 1
  fi
  ok "kubectl context: $ctx"
}

assert_core_rollouts() {
  export_kube_colima
  # api-gateway /readyz blocks on auth-service — match deploy-dev ordering.
  kubectl rollout status deployment/auth-service -n "$HOUSING_NS" --timeout=480s
  kubectl rollout status deployment/api-gateway -n "$HOUSING_NS" --timeout=480s
  kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=360s
  kubectl wait --for=condition=ready pod -l app=jaeger -n observability --timeout=240s
  ok "api-gateway, caddy-h3, jaeger ready"
}

# Match dev-orchestrator Phase 3: LibreSSL/mkcert may omit a readable EKU section in `x509 -text`; `-purpose` is portable.
_tls_leaf_purpose_ok() {
  local f="$1"
  openssl x509 -in "$f" -noout -purpose 2>/dev/null | grep -q 'SSL server : Yes' \
    && openssl x509 -in "$f" -noout -purpose 2>/dev/null | grep -q 'SSL client : Yes'
}

tls_leaf_eku_check() {
  [[ -f "$CA_PEM" ]] || { bad "missing $CA_PEM"; return 1; }
  openssl x509 -in "$CA_PEM" -noout -text | grep -q "CA:TRUE" || {
    bad "dev-root.pem missing CA:TRUE (expected dev CA)"
    return 1
  }
  local leaf=""
  for leaf in \
    "$REPO_ROOT/certs/off-campus-housing.test.pem" \
    "$REPO_ROOT/certs/off-campus-housing.test.crt" \
    "$REPO_ROOT/certs/record.test.pem"; do
    [[ -f "$leaf" ]] || continue
    if _tls_leaf_purpose_ok "$leaf"; then
      ok "leaf TLS server+client purposes OK: $(basename "$leaf")"
      return 0
    fi
  done
  say "Leaf PEM/CRT not on disk or unclear — checking served certificate (openssl s_client)"
  local purp
  purp="$(echo | openssl s_client -connect "${EDGE_HOST}:443" -servername "$EDGE_HOST" -showcerts 2>/dev/null \
    | openssl x509 -noout -purpose 2>/dev/null || true)"
  if grep -q 'SSL server : Yes' <<<"$purp" && grep -q 'SSL client : Yes' <<<"$purp"; then
    ok "served leaf has SSL server+client purposes (s_client)"
    return 0
  fi
  bad "Served cert missing SSL server+client purposes for $EDGE_HOST:443"
  return 1
}

curl_edge_health() {
  [[ -f "$CA_PEM" ]] || { bad "missing CA for curl"; return 1; }
  local url="https://${EDGE_HOST}/api/healthz"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 15 --max-time 90 \
    --cacert "$CA_PEM" "$url" 2>/dev/null || echo "000")"
  if [[ "$code" != "200" ]]; then
    bad "GET $url HTTP $code (expected 200; check /etc/hosts and MetalLB reachability for $EDGE_HOST)"
    return 1
  fi
  ok "curl edge /api/healthz HTTP 200 (CA verify)"
}

curl_edge_http3_optional() {
  [[ "${COLD_START_REQUIRE_HTTP3:-0}" != "1" ]] && return 0
  [[ -f "$CA_PEM" ]] || return 1
  local url="https://${EDGE_HOST}/api/healthz"
  if ! curl --help all 2>/dev/null | grep -q 'http3'; then
    bad "curl has no --http3; install modern curl or unset COLD_START_REQUIRE_HTTP3"
    return 1
  fi
  local ver
  ver="$(curl -sS -o /dev/null -w "%{http_version}" --http3 --connect-timeout 15 --max-time 90 \
    --cacert "$CA_PEM" "$url" 2>/dev/null || echo "0")"
  if [[ "$ver" != "3" ]]; then
    bad "expected HTTP version 3 from curl --http3, got $ver"
    return 1
  fi
  ok "curl --http3 /api/healthz uses HTTP/3"
}

kafka_tls_sanity() {
  chmod +x "$SCRIPT_DIR/verify-kafka-tls-sans.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$HOUSING_NS"
  make verify-kafka-bootstrap
  ok "verify-kafka-tls-sans.sh + make verify-kafka-bootstrap"
}

phase_d_verify_full() {
  say "Phase D — Assert Colima, Docker, kubectl, rollouts, TLS, edge, Kafka"
  assert_colima_running
  assert_docker_colima_context
  assert_kubectl_colima
  assert_core_rollouts
  tls_leaf_eku_check
  curl_edge_health
  curl_edge_http3_optional
  kafka_tls_sanity
  {
    echo ""
    echo "=== Phase D assertions: ALL OK @ $(ts) ==="
  } >>"$POST"
  ok "Phase D complete"
}

phase_d_verify_light() {
  say "Phase D-light — After second make dev"
  assert_colima_running
  assert_docker_colima_context
  assert_kubectl_colima
  curl_edge_health
  ok "Phase D-light complete"
}

write_metrics_json() {
  python3 -c "
import json, os
obj = {
  'started_at_unix': int(os.environ['T_START']),
  'ended_at_unix': int(os.environ['T_END']),
  'total_wall_seconds': int(os.environ['TOTAL_SEC']),
  'phase_b_prepare_seconds': int(os.environ['COLD_PREP_SEC']),
  'make_dev_round1_seconds': int(os.environ['MAKE_DEV_1_SEC']),
  'make_dev_verify_seconds': int(os.environ['DEV_VERIFY_SEC']),
  'make_dev_round2_seconds': int(os.environ['MAKE_DEV_2_SEC']),
  'cold_start_reset_certs': int(os.environ.get('COLD_START_RESET_CERTS', '0')),
  'edge_hostname': os.environ.get('EDGE_HOST', ''),
  'housing_ns': os.environ.get('HOUSING_NS', ''),
  'second_make_dev_faster_than_first': int(os.environ['MAKE_DEV_2_SEC']) < int(os.environ['MAKE_DEV_1_SEC']),
}
with open(os.environ['METRICS'], 'w', encoding='utf-8') as f:
    json.dump(obj, f, indent=2, sort_keys=True)
"
}

# --- main ---
T_START="$(now_s)"
COLD_START_CONFIRM_NORM="$(printf '%s' "${COLD_START_CONFIRM:-}" | tr '[:upper:]' '[:lower:]')"

say "Phase A — Snapshot (pre)"
snapshot_state "$PRE"

if [[ "$COLD_START_CONFIRM_NORM" != "yes" && "$COLD_START_CONFIRM_NORM" != "y" ]]; then
  say "Refusing destructive work without COLD_START_CONFIRM=yes"
  echo "Set COLD_START_CONFIRM=yes to run Phase B + full cold path (see script header)."
  exit 2
fi

if [[ "${COLD_START_ALLOW_NON_COLIMA:-0}" != "1" ]]; then
  command -v colima >/dev/null 2>&1 || {
    bad "colima not found; install Colima or set COLD_START_ALLOW_NON_COLIMA=1"
    exit 1
  }
fi

say "Phase B — Force clean environment (DESTRUCTIVE)"
T_B0="$(now_s)"
compose_down_if_possible
stop_all_running_containers
if [[ "${COLD_START_SKIP_PRUNE:-0}" != "1" ]]; then
  docker image prune -af 2>/dev/null || true
fi
if [[ "${COLD_START_ALLOW_NON_COLIMA:-0}" != "1" ]]; then
  colima stop 2>/dev/null || true
fi
unset KUBECONFIG
export KUBECONFIG=""
rm_workspace_node_modules
rm_dist_artifacts
if [[ "${COLD_START_RESET_CERTS:-0}" == "1" ]] && [[ -d "$REPO_ROOT/certs" ]]; then
  _bak="${BENCH}/dev-cold-start-certs-backup-$(now_s)"
  mv "$REPO_ROOT/certs" "$_bak"
  ok "moved certs/ to $_bak"
fi
T_B1="$(now_s)"
COLD_PREP_SEC=$((T_B1 - T_B0))
ok "Phase B complete (${COLD_PREP_SEC}s)"

say "Phase C — make dev (round 1)"
unset KUBECONFIG
export KUBECONFIG=""
if [[ "${COLD_START_ALLOW_NON_COLIMA:-0}" == "1" ]]; then
  export REQUIRE_COLIMA=0
fi
T_D1_0="$(now_s)"
make dev
T_D1_1="$(now_s)"
MAKE_DEV_1_SEC=$((T_D1_1 - T_D1_0))

_TMP_POST="$(mktemp "${TMPDIR:-/tmp}/och-cold-post.XXXXXX.txt")"
snapshot_state "$_TMP_POST"
{
  echo "cold-start POST log @ $(ts)"
  cat "$_TMP_POST"
} >"$POST"
rm -f "$_TMP_POST"

# Avoid pipe+tee losing lines when the subshell exits on first kubectl failure (SIGPIPE / stdio buffer).
_phase_d_out="$(mktemp "${TMPDIR:-/tmp}/och-phase-d-full.XXXXXX.log")"
if ! phase_d_verify_full >"$_phase_d_out" 2>&1; then
  cat "$_phase_d_out" | tee -a "$POST"
  rm -f "$_phase_d_out"
  exit 1
fi
cat "$_phase_d_out" | tee -a "$POST"
rm -f "$_phase_d_out"

say "make dev-verify (must exit 0)"
T_V0="$(now_s)"
make dev-verify
T_V1="$(now_s)"
DEV_VERIFY_SEC=$((T_V1 - T_V0))

say "make dev (round 2 — idempotency)"
T_D2_0="$(now_s)"
make dev
T_D2_1="$(now_s)"
MAKE_DEV_2_SEC=$((T_D2_1 - T_D2_0))

say "make dev-verify (second time, must exit 0)"
make dev-verify

_phase_d_light="$(mktemp "${TMPDIR:-/tmp}/och-phase-d-light.XXXXXX.log")"
if ! phase_d_verify_light >"$_phase_d_light" 2>&1; then
  cat "$_phase_d_light" | tee -a "$POST"
  rm -f "$_phase_d_light"
  exit 1
fi
cat "$_phase_d_light" | tee -a "$POST"
rm -f "$_phase_d_light"

T_END="$(now_s)"
TOTAL_SEC=$((T_END - T_START))

export T_START T_END TOTAL_SEC COLD_PREP_SEC MAKE_DEV_1_SEC DEV_VERIFY_SEC MAKE_DEV_2_SEC METRICS="$METRICS" EDGE_HOST HOUSING_NS
export COLD_START_RESET_CERTS="${COLD_START_RESET_CERTS:-0}"
write_metrics_json
ok "Wrote $METRICS"

_TMP_FIN="$(mktemp "${TMPDIR:-/tmp}/och-cold-fin.XXXXXX.txt")"
snapshot_state "$_TMP_FIN"
{
  echo ""
  echo "=== Final snapshot @ $(ts) ==="
  cat "$_TMP_FIN"
} >>"$POST"
rm -f "$_TMP_FIN"

say "Cold-start validation PASSED"
exit 0
