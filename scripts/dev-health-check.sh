#!/usr/bin/env bash
# Post-dev-up gates: Compose Postgres/Redis, api-gateway /readyz, Jaeger, strict TLS/mTLS preflight, Kafka bootstrap.
# Edge hostname defaults to OCH SNI: off-campus-housing.test
#
# Env: HOUSING_NS, OCH_EDGE_HOSTNAME, NS_ING, DEV_SKIP_STRICT_TLS_PREFLIGHT=1 to skip ensure-strict-tls-mtls-preflight.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
EDGE_HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
CA_PEM="${REPO_ROOT}/certs/dev-root.pem"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
bad() { echo "❌ $*" >&2; }

if command -v kubectl >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
    och_export_colima_kubeconfig_prefer_reachable || true
  elif [[ -z "${KUBECONFIG:-}" ]]; then
    och_export_colima_kubeconfig_prefer_reachable || {
      _k="${HOME}/.colima/default/kubernetes/kubeconfig"
      [[ -s "$_k" ]] || _k="${HOME}/.colima/default/kubeconfig"
      [[ -s "$_k" ]] && export KUBECONFIG="$_k"
    }
  fi
fi

say "dev-health-check — external infra (Docker Compose)"
if [[ -f "$REPO_ROOT/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qi postgres; then
    bad "No running container matching 'postgres' — run bring-up / make dev"
    exit 1
  fi
  if ! docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qi redis; then
    bad "No running container matching 'redis'"
    exit 1
  fi
  ok "docker ps shows postgres + redis related containers"
else
  bad "docker-compose.yml or docker missing"
  exit 1
fi

say "dev-health-check — curl"
command -v curl >/dev/null 2>&1 || { bad "curl not in PATH"; exit 1; }
ok "$(curl --version | head -1)"
if ! curl --version 2>/dev/null | head -1 | grep -qE 'curl 8\.(1[9]|[2-9][0-9])\.|curl 9\.'; then
  warn "curl 8.19+ recommended (HTTP/3 + --retry-all-errors). Install current curl if edge checks flake."
fi

say "dev-health-check — Service Endpoints (cluster routing gate)"
if [[ -f "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh" ]]; then
  bash "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh"
else
  warn "wait-for-housing-service-endpoints.sh missing — skipping Endpoint gate"
fi

say "dev-health-check — api-gateway /readyz (HTTPS $EDGE_HOST)"
[[ -f "$CA_PEM" ]] || { bad "missing $CA_PEM"; exit 1; }
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"
_readyz_attempts="${DEV_READYZ_ATTEMPTS:-25}"
_readyz_delay="${DEV_READYZ_DELAY_SEC:-3}"
_curl_retry_ex=()
if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
  _curl_retry_ex+=(--retry-all-errors)
fi
code="000"
for ((_i = 1; _i <= _readyz_attempts; _i++)); do
  code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 60 \
    --retry 4 --retry-delay 2 --retry-connrefused \
    "${_curl_retry_ex[@]}" \
    --cacert "$CA_PEM" \
    -H "x-traffic-class: infra" -H "x-suite: ${OCH_X_SUITE}" \
    "https://${EDGE_HOST}/api/readyz" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]] && break
  sleep "$_readyz_delay"
done
if [[ "$code" != "200" ]]; then
  bad "GET https://${EDGE_HOST}/api/readyz → HTTP $code after ${_readyz_attempts} attempts (want 200)"
  exit 1
fi
ok "/readyz HTTP 200"

say "dev-health-check — Jaeger (observability)"
kubectl wait --for=condition=ready pod -l app=jaeger -n observability --timeout=120s
ok "Jaeger pod ready"

if [[ "${DEV_SKIP_STRICT_TLS_PREFLIGHT:-0}" != "1" ]]; then
  say "dev-health-check — strict TLS/mTLS preflight (in-cluster)"
  chmod +x "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"
  bash "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"
fi

say "dev-health-check — Kafka bootstrap (ConfigMap)"
command make -C "$REPO_ROOT" verify-kafka-bootstrap

ok "dev-health-check complete"
