#!/usr/bin/env bash
# After E2E / load, assert Jaeger has seen every Node service that bootstraps OpenTelemetry
# (matches services/*/src/otel-bootstrap.ts initTracing("<name>") — global instrumentation coverage).
# Per-vertical same-trace contracts: verify-jaeger-trace-structure.sh
#
# Requires JAEGER_QUERY_BASE after resolution — origin with /api/services, e.g. https://off-campus-housing.test/jaeger
# or http://<metallb-ip>:16686. Auto: scripts/lib/jaeger-resolve-query-base.sh (JAEGER_PUBLIC_URL, edge /jaeger, LB).
#
# Env (optional):
#   JAEGER_SERVICES_VERIFY_ATTEMPTS — default 20 (poll /api/services until all required names appear).
#   JAEGER_SERVICES_VERIFY_SLEEP_SEC — default 2 (sleep between attempts; BatchSpanProcessor can lag after E2E).
#   JAEGER_LIVENESS_AUTO_PORT_FORWARD — default 1: loopback + unreachable → kubectl port-forward (scripts/lib/jaeger-local-port-forward.sh).
#   JAEGER_SEED_AUTH_BEFORE_VERIFY — default 1: POST /api/auth/register + /api/auth/login on OCH edge before polling Jaeger services.
#   OCH_EDGE_URL — optional explicit https://host (else derived from JAEGER_QUERY_BASE by stripping /jaeger).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh" ]] && source "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh"
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/lib/jaeger-local-port-forward.sh" ]] && source "$SCRIPT_DIR/lib/jaeger-local-port-forward.sh"

if command -v och_jaeger_resolve_query_base >/dev/null 2>&1; then
  och_jaeger_resolve_query_base || true
fi
: "${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE, JAEGER_PUBLIC_URL, or edge https://off-campus-housing.test/jaeger}"

BASE="${JAEGER_QUERY_BASE%/}"

if command -v och_jaeger_try_autopf >/dev/null 2>&1; then
  och_jaeger_try_autopf || true
fi

_jaeger_curl_services() {
  local maxt="${1:-10}"
  local out="${2:-}"
  if [[ "$BASE" == https:* ]]; then
    local ca="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
    [[ -f "$ca" ]] || return 1
    if [[ -n "$out" ]]; then
      curl -sfS --max-time "$maxt" --cacert "$ca" "${BASE}/api/services" -o "$out"
    else
      curl -sfS --max-time "$maxt" --cacert "$ca" "${BASE}/api/services" -o /dev/null
    fi
  else
    if [[ -n "$out" ]]; then
      curl -sfS --max-time "$maxt" "${BASE}/api/services" -o "$out"
    else
      curl -sfS --max-time "$maxt" "${BASE}/api/services" -o /dev/null
    fi
  fi
}

_ATTEMPTS="${JAEGER_SERVICES_VERIFY_ATTEMPTS:-20}"
_SLEEP="${JAEGER_SERVICES_VERIFY_SLEEP_SEC:-2}"
_UI_READY_ATTEMPTS="${JAEGER_UI_READY_ATTEMPTS:-5}"
_UI_READY_SLEEP="${JAEGER_UI_READY_SLEEP_SEC:-2}"

tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

# Jaeger returns JSON with a "data" array of service names (keep in sync with otel-bootstrap service names).
required=(
  api-gateway
  auth-service
  booking-service
  listings-service
  analytics-service
  messaging-service
  trust-service
  media-service
  notification-service
)

wait_for_jaeger_ui() {
  local i=1
  while [[ "$i" -le "$_UI_READY_ATTEMPTS" ]]; do
    if _jaeger_curl_services 10 "$tmp"; then
      return 0
    fi
    if [[ "$i" -lt "$_UI_READY_ATTEMPTS" ]]; then
      sleep "$_UI_READY_SLEEP"
    fi
    i=$((i + 1))
  done
  echo "verify-jaeger-tracing-services: infra unavailable — Jaeger query endpoint unreachable: ${BASE}/api/services"
  echo "Hint: check Jaeger pod readiness/restarts and MetalLB routing before trace assertions."
  return 1
}

check_once() {
  missing=()
  _jaeger_curl_services 15 "$tmp" || {
    echo "verify-jaeger-tracing-services: GET ${BASE}/api/services failed"
    return 1
  }
  for svc in "${required[@]}"; do
    if ! grep -qF "\"${svc}\"" "$tmp" && ! grep -qF "\"$svc\"" "$tmp"; then
      missing+=("$svc")
    fi
  done
  [[ ${#missing[@]} -eq 0 ]]
}

if ! wait_for_jaeger_ui; then
  exit 2
fi

# Deterministic: hit auth register+login so auth-service emits OTLP before we poll /api/services
# (avoids false negatives when Step7 / k6 did not touch auth). Skip: JAEGER_SEED_AUTH_BEFORE_VERIFY=0
seed_auth_before_verify() {
  [[ "${JAEGER_SEED_AUTH_BEFORE_VERIFY:-1}" == "1" ]] || return 0
  local edge="${OCH_EDGE_URL:-}"
  if [[ -z "$edge" ]]; then
    if [[ "$BASE" == */jaeger ]]; then
      edge="${BASE%/jaeger}"
    else
      edge="https://off-campus-housing.test"
    fi
  fi
  echo "verify-jaeger-tracing-services: seeding auth (POST register + login) at ${edge} …"
  local ca="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
  local curl_ca=()
  [[ -f "$ca" ]] && curl_ca=(--cacert "$ca")
  local reg='{"email":"och-jaeger-seed@local.invalid","password":"OchSeedV1!x","sendVerification":false}'
  curl -sS --max-time 25 "${curl_ca[@]}" -H "Content-Type: application/json" -d "$reg" "${edge}/api/auth/register" >/dev/null 2>&1 || true
  curl -sS --max-time 25 "${curl_ca[@]}" -H "Content-Type: application/json" \
    -d '{"email":"och-jaeger-seed@local.invalid","password":"OchSeedV1!x"}' "${edge}/api/auth/login" >/dev/null 2>&1 || true
}
seed_auth_before_verify

_ok=0
for ((_i = 1; _i <= _ATTEMPTS; _i++)); do
  if check_once; then
    _ok=1
    break
  fi
  if [[ "$_i" -eq 1 ]]; then
    echo "verify-jaeger-tracing-services: incomplete (${#missing[@]} services missing); retrying up to ${_ATTEMPTS} polls (${_SLEEP}s apart) for OTLP batch export…"
  fi
  if [[ "$_i" -lt "$_ATTEMPTS" ]]; then
    sleep "$_SLEEP"
  fi
done

if [[ "$_ok" != "1" ]]; then
  echo "verify-jaeger-tracing-services: missing services in Jaeger after ${_ATTEMPTS} attempts: ${missing[*]}"
  echo "Response sample:"
  head -c 2000 "$tmp" || true
  echo
  exit 1
fi

echo "verify-jaeger-tracing-services: OK — Jaeger lists required services (${#required[@]} checked)"
