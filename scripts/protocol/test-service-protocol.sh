#!/usr/bin/env bash
# Universal per-service protocol checks: HTTP/2, HTTP/3 strict (--http3-only), optional gRPC edge + in-pod, downgrade hints.
# Intended to be invoked with env vars set (see scripts/protocol/test-*-protocol.sh wrappers or full-edge-transport-validation.sh).
#
# Required env:
#   SERVICE_KEY          e.g. auth
#   GATEWAY_HEALTH_PATH  e.g. /api/auth/healthz (via Caddy → api-gateway)
# Optional:
#   K8S_DEPLOY           e.g. auth-service (for in-pod gRPC health)
#   GRPC_PORT            e.g. 50061; 0 = skip pod gRPC
#   GRPC_PROBE_SERVICE   e.g. auth.AuthService (grpc-health-probe -service=)
#   NS                   default off-campus-housing-tracker
#   HOST, PORT, TARGET_IP, CA_CERT — same as housing HTTP suites
#   CURL_MAX_TIME        default 15
#   PROTOCOL_CURL_RETRIES default 3
#   OUT_JSON             if set, write machine-readable summary here
#
# Exit: 0 all mandatory checks pass, 1 otherwise (H3 strict may soft-skip if curl has no --http3-only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export PATH="$SCRIPT_DIR/../shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

NS="${NS:-off-campus-housing-tracker}"
HOST="${HOST:-off-campus-housing.test}"
CURL="${CURL_BIN:-$(command -v curl)}"
CURL_MAX_TIME="${CURL_MAX_TIME:-15}"
RETRIES="${PROTOCOL_CURL_RETRIES:-3}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

_kb() { kubectl --request-timeout=15s "$@" 2>/dev/null || true; }

if [[ -z "${SERVICE_KEY:-}" ]] || [[ -z "${GATEWAY_HEALTH_PATH:-}" ]]; then
  echo "SERVICE_KEY and GATEWAY_HEALTH_PATH are required" >&2
  exit 1
fi

K8S_DEPLOY="${K8S_DEPLOY:-}"
GRPC_PORT="${GRPC_PORT:-0}"
GRPC_PROBE_SERVICE="${GRPC_PROBE_SERVICE:-}"

# Resolve PORT / TARGET_IP like housing suite
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  _lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -z "$_lb" ]] && _lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  [[ -n "$_lb" ]] && export TARGET_IP="$_lb"
  if [[ -n "${TARGET_IP:-}" ]]; then
    PORT="${PORT:-443}"
  else
    PORT="${PORT:-30443}"
    DETECTED=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
    [[ -n "$DETECTED" ]] && PORT=$DETECTED
  fi
fi

CA_CERT="${CA_CERT:-}"
if [[ -z "$CA_CERT" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  CA_CERT="$REPO_ROOT/certs/dev-root.pem"
fi
K8S_CA=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -z "$CA_CERT" ]] && [[ -n "$K8S_CA" ]] && echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
  CA_CERT="/tmp/protocol-test-ca-$$.pem"
  echo "$K8S_CA" > "$CA_CERT"
  trap 'rm -f /tmp/protocol-test-ca-$$.pem' EXIT
fi

strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    "$CURL" --cacert "$CA_CERT" "$@"
  else
    "$CURL" -k "$@"
  fi
}

strict_http3_curl() {
  local ca_args=()
  [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && ca_args+=(--cacert "$CA_CERT") || ca_args+=(-k)
  if type http3_curl &>/dev/null 2>&1; then
    HTTP3_CA_CERT="${CA_CERT:-}" http3_curl "${ca_args[@]}" --http3-only "$@"
  elif "$CURL" --help all 2>&1 | grep -q -- "--http3-only"; then
    "$CURL" "${ca_args[@]}" --http3-only "$@"
  else
    return 2
  fi
}

# curl resolve / host header
CURL_H2_RESOLVE=()
if [[ -n "${TARGET_IP:-}" ]]; then
  CURL_H2_RESOLVE=(--resolve "$HOST:$PORT:$TARGET_IP")
else
  CURL_H2_RESOLVE=(-H "Host: $HOST")
fi

BASE_URL="https://$HOST:$PORT"
FULL_URL="${BASE_URL}${GATEWAY_HEALTH_PATH}"

http2_ok=0
http3_strict_ok=0
http3_skipped=0
http3_version=""
alt_svc_present=0
downgrade_detected=0
grpc_edge_ok=0
grpc_edge_skipped=0
grpc_pod_ok=0
grpc_pod_skipped=0
PROTOCOL_ERRORS=()

append_err() {
  PROTOCOL_ERRORS+=("$1")
}

retry_curl() {
  local label="$1"
  shift
  local attempt out
  for attempt in $(seq 1 "$RETRIES"); do
    if out=$("$@" 2>&1); then
      echo "$out"
      return 0
    fi
    warn "$label attempt $attempt/$RETRIES failed${out:+: $(echo "$out" | head -1)}"
    sleep 1
  done
  return 1
}

# --- HTTP/2 health ---
say "[$SERVICE_KEY] HTTP/2 GET $GATEWAY_HEALTH_PATH"
h2_out=""
if h2_out=$(retry_curl "H2" strict_curl -sS -w "\n%{http_code}\n%{http_version}" --http2 --max-time "$CURL_MAX_TIME" \
  "${CURL_H2_RESOLVE[@]}" "$FULL_URL"); then
  h2_code=$(echo "$h2_out" | tail -2 | head -1)
  h2_ver=$(echo "$h2_out" | tail -1)
  if [[ "$h2_code" == "200" ]]; then
    ok "H2 health HTTP $h2_code version=$h2_ver"
    http2_ok=1
  else
    append_err "H2 health HTTP $h2_code"
    warn "H2 unexpected code $h2_code"
  fi
else
  append_err "H2 health curl failed after retries"
fi

# --- alt-svc (edge advertises QUIC) ---
if headers=$(retry_curl "H2-HEAD" strict_curl -sS -I --http2 --max-time "$CURL_MAX_TIME" \
  "${CURL_H2_RESOLVE[@]}" "$FULL_URL"); then
  if echo "$headers" | grep -qi '^alt-svc:'; then
    alt_svc_present=1
    ok "alt-svc present on edge response"
  else
    append_err "alt-svc header missing (QUIC may not be advertised)"
  fi
else
  append_err "HEAD for alt-svc failed"
fi

# --- HTTP/3 strict ---
say "[$SERVICE_KEY] HTTP/3 strict (--http3-only) $GATEWAY_HEALTH_PATH"
h3_out=""
h3_capable=0
"$CURL" --help all 2>&1 | grep -q -- "--http3-only" && h3_capable=1
type http3_curl &>/dev/null && h3_capable=1
if [[ "$h3_capable" -eq 0 ]]; then
  warn "No curl --http3-only and no http3_curl; skip strict HTTP/3"
  http3_skipped=1
elif h3_out=$(retry_curl "H3" strict_http3_curl -sS -w "\n%{http_code}\n%{http_version}" --max-time "$CURL_MAX_TIME" \
  "${CURL_H2_RESOLVE[@]}" "$FULL_URL"); then
  h3_code=$(echo "$h3_out" | tail -2 | head -1)
  http3_version=$(echo "$h3_out" | tail -1)
  if [[ "$h3_code" == "200" ]]; then
    if echo "$http3_version" | grep -qE '3|HTTP/3'; then
      http3_strict_ok=1
      ok "H3 strict OK (HTTP $h3_code, version=$http3_version)"
    else
      downgrade_detected=1
      append_err "H3 strict: got HTTP $h3_code but version='$http3_version' (expected HTTP/3 / 3)"
    fi
  else
    append_err "H3 strict HTTP $h3_code"
  fi
else
  append_err "HTTP/3 strict curl failed after retries"
fi

# --- gRPC edge (Envoy :443) ---
proto_dir=""
[[ -d "$REPO_ROOT/proto" ]] && proto_dir="$REPO_ROOT/proto"
[[ -z "$proto_dir" ]] && [[ -d "$REPO_ROOT/infra/k8s/base/config/proto" ]] && proto_dir="$REPO_ROOT/infra/k8s/base/config/proto"

if [[ -n "${TARGET_IP:-}" ]] && command -v grpcurl >/dev/null 2>&1 && [[ -d "$proto_dir" ]] && [[ -f "$proto_dir/health.proto" ]]; then
  say "[$SERVICE_KEY] gRPC Health/Check edge ${TARGET_IP}:443"
  grpc_certs_dir="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
  # shellcheck source=scripts/lib/ensure-och-grpc-certs.sh
  [[ -f "$SCRIPT_DIR/../lib/ensure-och-grpc-certs.sh" ]] && source "$SCRIPT_DIR/../lib/ensure-och-grpc-certs.sh" && och_sync_grpc_certs_to_dir "$grpc_certs_dir" "$NS" 2>/dev/null || true
  ca_file="${CA_CERT:-}"
  [[ -z "$ca_file" ]] && [[ -f "$grpc_certs_dir/ca.crt" ]] && ca_file="$grpc_certs_dir/ca.crt"
  if [[ -n "$ca_file" ]] && [[ -f "$ca_file" ]]; then
    out=$(grpcurl -cacert "$ca_file" -authority "$HOST" \
      -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 10 -d '{"service":""}' \
      "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || true
    if echo "$out" | grep -q "SERVING"; then
      grpc_edge_ok=1
      ok "gRPC edge Health/Check SERVING"
    else
      append_err "gRPC edge failed: $(echo "$out" | head -c 200)"
    fi
  else
    grpc_edge_skipped=1
    append_err "gRPC edge skipped (no CA)"
  fi
else
  grpc_edge_skipped=1
fi

# --- gRPC in-pod ---
if [[ -n "$K8S_DEPLOY" ]] && [[ "${GRPC_PORT:-0}" =~ ^[1-9][0-9]*$ ]] && [[ -n "$GRPC_PROBE_SERVICE" ]]; then
  say "[$SERVICE_KEY] gRPC in-pod $K8S_DEPLOY :$GRPC_PORT ($GRPC_PROBE_SERVICE)"
  if _kb -n "$NS" get "deploy/$K8S_DEPLOY" &>/dev/null; then
    out=$(_kb -n "$NS" exec "deploy/$K8S_DEPLOY" -- /usr/local/bin/grpc-health-probe \
      -addr="localhost:$GRPC_PORT" -service="$GRPC_PROBE_SERVICE" \
      -tls -tls-no-verify=false -tls-ca-cert=/etc/certs/ca.crt \
      -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key \
      -tls-server-name=localhost -connect-timeout=5s -rpc-timeout=5s 2>&1) || true
    if echo "$out" | grep -qi healthy; then
      grpc_pod_ok=1
      ok "gRPC pod health OK"
    else
      append_err "gRPC pod probe: $(echo "$out" | head -c 300)"
    fi
  else
    append_err "deployment $K8S_DEPLOY not found in $NS"
  fi
else
  grpc_pod_skipped=1
fi

overall_ok=1
[[ "$http2_ok" -eq 1 ]] || overall_ok=0
[[ "$http3_skipped" -eq 1 ]] || { [[ "$http3_strict_ok" -eq 1 ]] && [[ "$downgrade_detected" -eq 0 ]] || overall_ok=0; }

# Optional Envoy retry snapshot (best-effort)
envoy_log_hint=""
if [[ "${CAPTURE_ENVOY_RETRIES:-0}" == "1" ]]; then
  envoy_log_hint=$(_kb -n envoy-test logs deploy/envoy-test --tail=120 2>&1 | grep -iE 'retry|upstream reset|503' | tail -5 | tr '\n' '; ' || true)
fi

errors_json="[]"
if ((${#PROTOCOL_ERRORS[@]})); then
  errors_json=$(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "${PROTOCOL_ERRORS[@]}")
fi

if [[ -n "${OUT_JSON:-}" ]]; then
  SK="$SERVICE_KEY" H2="$http2_ok" H3="$http3_strict_ok" H3S="$http3_skipped" H3V="$http3_version" \
    AS="$alt_svc_present" DG="$downgrade_detected" GE="$grpc_edge_ok" GES="$grpc_edge_skipped" \
    GP="$grpc_pod_ok" GPS="$grpc_pod_skipped" EL="${envoy_log_hint:-}" EJ="$errors_json" OA="$overall_ok" OUT="$OUT_JSON" \
    node -e '
const o = {
  service: process.env.SK,
  http2_health_ok: process.env.H2 === "1",
  http3_strict_ok: process.env.H3 === "1",
  http3_skipped: process.env.H3S === "1",
  http3_http_version: process.env.H3V || "",
  alt_svc_present: process.env.AS === "1",
  downgrade_detected: process.env.DG === "1",
  grpc_edge_ok: process.env.GE === "1",
  grpc_edge_skipped: process.env.GES === "1",
  grpc_pod_ok: process.env.GP === "1",
  grpc_pod_skipped: process.env.GPS === "1",
  envoy_retry_hints: process.env.EL || "",
  errors: JSON.parse(process.env.EJ || "[]"),
  overall_ok: process.env.OA === "1",
};
require("fs").writeFileSync(process.env.OUT, JSON.stringify(o, null, 2) + "\n");
'
fi

[[ "$overall_ok" -eq 1 ]]
exit $?
