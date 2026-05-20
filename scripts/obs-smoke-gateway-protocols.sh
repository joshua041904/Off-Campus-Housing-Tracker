#!/usr/bin/env bash
# Force h1/h2/h3 edge requests; classify failures; push protocol smoke metrics to Pushgateway.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"
RUN_ID="${OCH_GATEWAY_SMOKE_RUN_ID:-$(och_read_run_id "$ROOT")}"

HOST="${HOST:-off-campus-housing.test}"
BASE_URL="${BASE_URL:-https://${HOST}}"
PROBE_PATH="${GATEWAY_SMOKE_PATH:-/api/readyz}"
H3_PROBE_PATH="${GATEWAY_SMOKE_H3_PATH:-/api/readyz}"
ALLOW_H3_FAIL="${ALLOW_H3_FAIL:-0}"
H3_RETRIES="${GATEWAY_SMOKE_H3_RETRIES:-3}"

curl_has_http3() {
  command -v curl >/dev/null 2>&1 && curl --version 2>/dev/null | grep -qiE 'http3|ngtcp2|nghttp3'
}

resolve_target_ip() {
  if [[ -n "${TARGET_IP:-}" ]]; then
    echo "$TARGET_IP"
    return 0
  fi
  if [[ -n "${CADDY_LB_IP:-}" ]]; then
    echo "$CADDY_LB_IP"
    return 0
  fi
  if command -v kubectl >/dev/null 2>&1; then
    local ip
    ip="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  fi
  if [[ -r /etc/hosts ]]; then
    awk -v h="$HOST" '$2 == h { print $1; exit }' /etc/hosts 2>/dev/null || true
  fi
}

classify_curl_stderr() {
  local err="$1"
  if [[ -z "$err" ]]; then
    echo "unknown"
    return 0
  fi
  if grep -qiE 'SSL certificate problem|certificate verify failed|SSL peer certificate' <<<"$err"; then
    echo "tls_verify_failed"
  elif grep -qiE 'Could not resolve host|resolve host' <<<"$err"; then
    echo "dns_resolve_failed"
  elif grep -qiE 'Connection timed out|Timeout was reached|timed out' <<<"$err"; then
    echo "connect_timeout"
  elif grep -qiE 'Failed to connect|Couldn.t connect|Connection refused' <<<"$err"; then
    echo "connect_failed"
  elif grep -qiE 'Failed sending data to the peer|\(55\)' <<<"$err"; then
    echo "quic_peer_reset"
  elif grep -qiE 'HTTP/3 is not supported|HTTP/3 unavailable|does not support HTTP/3' <<<"$err"; then
    echo "client_http3_unsupported"
  elif grep -qiE 'ALT-SVC|alt-svc' <<<"$err"; then
    echo "alt_svc_required"
  elif grep -qiE 'SSL|TLS|handshake' <<<"$err"; then
    echo "tls_handshake_failed"
  else
    echo "curl_error"
  fi
}

http_version_metric_label() {
  case "${1:-}" in
    1.0 | 1.1) echo "1.1" ;;
    2) echo "2" ;;
    3) echo "3" ;;
    *) echo "unknown" ;;
  esac
}

edge_debug_header_match() {
  local expected="$1" dbg="$2"
  local d
  d="$(printf '%s' "$dbg" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ -z "$d" ]] && echo 1 && return 0
  [[ "$d" == "$expected" ]] && echo 1 || echo 0
}

fetch_x_och_debug_edge_proto() {
  local url="$1" resolve_ip="$2"
  shift 2
  local curl_base=(-sSI --connect-timeout 10 --max-time 15 -o /dev/null)
  if [[ -n "${CA_CERT:-}" ]]; then
    curl_base+=(--cacert "$CA_CERT")
  else
    curl_base+=(-k)
  fi
  if [[ -n "$resolve_ip" ]]; then
    curl_base+=(--resolve "${HOST}:443:${resolve_ip}")
  fi
  curl "${curl_base[@]}" "$@" "$url" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="x-och-debug-edge-proto" {gsub(/^[ \t]+|[ \t]+$/,"",$2); print tolower($2); exit}'
}

probe_http() {
  local proto="$1"
  shift
  local url="$1"
  local resolve_ip="${2:-}"
  shift 2
  local stderr_file http_code http_version edge_proto curl_rc=0 attempt max_attempts=1

  [[ "$proto" == h3 ]] && max_attempts="$H3_RETRIES"

  local curl_base=(-sS --no-progress-meter --connect-timeout 10 --max-time 20 -o /dev/null -w "%{http_code}\n%{http_version}")
  if [[ -n "${CA_CERT:-}" ]]; then
    curl_base+=(--cacert "$CA_CERT")
  else
    curl_base+=(-k)
  fi
  if [[ -n "$resolve_ip" ]]; then
    curl_base+=(--resolve "${HOST}:443:${resolve_ip}")
  fi

  stderr_file="$(mktemp)"
  local reason="" stderr_text=""

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    curl_rc=0
    local raw_out
    raw_out="$(curl "${curl_base[@]}" "$@" "$url" 2>"$stderr_file")" || curl_rc=$?
    http_version="$(printf '%s' "$raw_out" | tail -1 | tr -d '\r\n[:space:]')"
    http_code="$(printf '%s' "$raw_out" | tail -2 | head -1 | tr -d '\r\n[:space:]')"
    [[ "$http_code" =~ ^[0-9]{3}$ ]] || http_code="000"
    if [[ "$proto" == h3 && "$http_code" == "200" && "$http_version" == "3" ]]; then
      rm -f "$stderr_file"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' ok http_200 "$http_code" "$http_version" h3 "$curl_rc" ""
      return 0
    fi
    if [[ "$proto" != h3 && "$http_code" == "200" ]]; then
      rm -f "$stderr_file"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' ok http_200 "$http_code" "$http_version" "$proto" "$curl_rc" ""
      return 0
    fi
    if [[ "$proto" == h3 && "$curl_rc" -ne 0 && "$attempt" -lt "$max_attempts" ]]; then
      sleep 1
      continue
    fi
    break
  done

  stderr_text="$(tr '\n' ' ' <"$stderr_file" | sed 's/\t/ /g' || true)"
  rm -f "$stderr_file"
  if [[ "$proto" == h3 && "$http_code" == "200" && "$http_version" != "3" ]]; then
    reason="http_version_not_3"
  elif [[ "$http_code" != "000" && "$http_code" != "200" ]]; then
    reason="http_${http_code}"
  elif [[ "$curl_rc" -ne 0 ]]; then
    reason="$(classify_curl_stderr "$stderr_text")"
  elif [[ "$http_code" == "000" ]]; then
    reason="connect_failed"
  else
    reason="unknown"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' fail "$reason" "$http_code" "$http_version" "" "$curl_rc" "$stderr_text"
}

TARGET_IP="$(resolve_target_ip || true)"
[[ -n "$TARGET_IP" ]] || TARGET_IP=""

echo "== Gateway protocol smoke =="
echo "  host=${HOST} resolve_ip=${TARGET_IP:-<none>} path_h12=${PROBE_PATH} path_h3=${H3_PROBE_PATH}"

h1_ok=0 h2_ok=0 h3_ok=0
h1_reason="" h2_reason="" h3_reason=""
client_h3_supported=0
if curl_has_http3; then client_h3_supported=1; fi

IFS=$'\t' read -r _h1_status h1_reason _h1_code _h1_ver _h1_edge _h1_rc _h1_err < <(probe_http h1 "$BASE_URL${PROBE_PATH}" "$TARGET_IP" --http1.1)
[[ "$_h1_status" == ok ]] && h1_ok=1
echo "  h1 (--http1.1): HTTP ${_h1_code:-?} version=${_h1_ver:-?} rc=${_h1_rc:-?}${h1_reason:+ reason=$h1_reason}"
[[ -n "${_h1_err:-}" ]] && [[ "$h1_ok" != 1 ]] && echo "    stderr: $(echo "$_h1_err" | head -2 | tr '\n' ' ')"

IFS=$'\t' read -r _h2_status h2_reason _h2_code _h2_ver _h2_edge _h2_rc _h2_err < <(probe_http h2 "$BASE_URL${PROBE_PATH}" "$TARGET_IP" --http2)
[[ "$_h2_status" == ok ]] && h2_ok=1
echo "  h2 (--http2): HTTP ${_h2_code:-?} version=${_h2_ver:-?} rc=${_h2_rc:-?}${h2_reason:+ reason=$h2_reason}"
[[ -n "${_h2_err:-}" ]] && [[ "$h2_ok" != 1 ]] && echo "    stderr: $(echo "$_h2_err" | head -2 | tr '\n' ' ')"

if [[ "$client_h3_supported" == 1 ]]; then
  if [[ -z "$TARGET_IP" ]]; then
    h3_reason="resolve_missing"
    echo "  h3 (--http3-only): skipped (no MetalLB / hosts resolve IP)"
  else
    IFS=$'\t' read -r _h3_status h3_reason _h3_code _h3_ver _h3_edge _h3_rc _h3_err < <(
      probe_http h3 "$BASE_URL${H3_PROBE_PATH}" "$TARGET_IP" --http3-only -H "Host: ${HOST}"
    )
    [[ "$_h3_status" == ok ]] && h3_ok=1
    echo "  h3 (--http3-only): HTTP ${_h3_code:-?} version=${_h3_ver:-?} rc=${_h3_rc:-?}${h3_reason:+ reason=$h3_reason}"
    [[ -n "${_h3_err:-}" ]] && [[ "$h3_ok" != 1 ]] && echo "    stderr: $(echo "$_h3_err" | head -3 | tr '\n' ' ')"
  fi
else
  h3_reason="curl_no_http3"
  echo "  h3: client curl lacks HTTP/3 (ngtcp2/nghttp3)"
fi

DBG_H1="" DBG_H2="" DBG_H3=""
if [[ -n "$TARGET_IP" ]]; then
  [[ "$h1_ok" == 1 ]] && DBG_H1="$(fetch_x_och_debug_edge_proto "${BASE_URL}${PROBE_PATH}" "$TARGET_IP" --http1.1)" || true
  [[ "$h2_ok" == 1 ]] && DBG_H2="$(fetch_x_och_debug_edge_proto "${BASE_URL}${PROBE_PATH}" "$TARGET_IP" --http2)" || true
  [[ "$h3_ok" == 1 ]] && DBG_H3="$(fetch_x_och_debug_edge_proto "${BASE_URL}${H3_PROBE_PATH}" "$TARGET_IP" --http3-only -H "Host: ${HOST}")" || true
fi
h1_hdr_match=1 h2_hdr_match=1 h3_hdr_match=1
[[ "$h1_ok" == 1 ]] && h1_hdr_match="$(edge_debug_header_match h1 "$DBG_H1")"
[[ "$h2_ok" == 1 ]] && h2_hdr_match="$(edge_debug_header_match h2 "$DBG_H2")"
[[ "$h3_ok" == 1 ]] && h3_hdr_match="$(edge_debug_header_match h3 "$DBG_H3")"

hv1="$(http_version_metric_label "${_h1_ver:-}")"
hv2="$(http_version_metric_label "${_h2_ver:-}")"
hv3="$(http_version_metric_label "${_h3_ver:-}")"

unknown_ratio=0
if command -v kubectl >/dev/null 2>&1; then
  unknown_ratio="$(kubectl exec -n "${HOUSING_NS:-off-campus-housing-tracker}" deploy/api-gateway -- node -e "
    const { register } = require('prom-client');
    const m = register.getSingleMetric('http_requests_total');
    if (!m) { console.log('0'); process.exit(0); }
    const vals = m.get().values || [];
    let u = 0, t = 0;
    for (const v of vals) {
      if (v.metricName !== 'http_requests_total') continue;
      const p = v.labels.proto || 'unknown';
      t += v.value;
      if (p === 'unknown') u += v.value;
    }
    console.log(t > 0 ? (u / t).toFixed(6) : '0');
  " 2>/dev/null || echo 0)"
fi

prom="$ROOT/bench_logs/och-gateway-protocol-smoke.prom"
mkdir -p "$(dirname "$prom")"
{
  cat <<EOF
# HELP och_gateway_protocol_smoke_supported 1 when curl build supports HTTP/3.
# TYPE och_gateway_protocol_smoke_supported gauge
och_gateway_protocol_smoke_supported{run_id="${RUN_ID}"} ${client_h3_supported}
# HELP och_gateway_protocol_smoke_success 1 when forced-protocol probe returned HTTP 200 (h3 also requires version 3).
# TYPE och_gateway_protocol_smoke_success gauge
och_gateway_protocol_smoke_success{proto="h1",run_id="${RUN_ID}"} ${h1_ok}
och_gateway_protocol_smoke_success{proto="h2",run_id="${RUN_ID}"} ${h2_ok}
och_gateway_protocol_smoke_success{proto="h3",run_id="${RUN_ID}"} ${h3_ok}
# HELP och_gateway_protocol_smoke_http_version 1 on successful forced-protocol probe; http_version from curl.
# TYPE och_gateway_protocol_smoke_http_version gauge
och_gateway_protocol_smoke_http_version{proto="h1",http_version="${hv1}",run_id="${RUN_ID}"} ${h1_ok}
och_gateway_protocol_smoke_http_version{proto="h2",http_version="${hv2}",run_id="${RUN_ID}"} ${h2_ok}
och_gateway_protocol_smoke_http_version{proto="h3",http_version="${hv3}",run_id="${RUN_ID}"} ${h3_ok}
# HELP och_gateway_protocol_smoke_edge_header_match 1 when X-OCH-Debug-Edge-Proto is absent or matches forced proto (requires OCH_EDGE_PROTO_DEBUG on gateway).
# TYPE och_gateway_protocol_smoke_edge_header_match gauge
och_gateway_protocol_smoke_edge_header_match{proto="h1",run_id="${RUN_ID}"} ${h1_hdr_match}
och_gateway_protocol_smoke_edge_header_match{proto="h2",run_id="${RUN_ID}"} ${h2_hdr_match}
och_gateway_protocol_smoke_edge_header_match{proto="h3",run_id="${RUN_ID}"} ${h3_hdr_match}
# HELP och_gateway_protocol_smoke_ok Legacy alias for och_gateway_protocol_smoke_success.
# TYPE och_gateway_protocol_smoke_ok gauge
och_gateway_protocol_smoke_ok{proto="h1",run_id="${RUN_ID}"} ${h1_ok}
och_gateway_protocol_smoke_ok{proto="h2",run_id="${RUN_ID}"} ${h2_ok}
och_gateway_protocol_smoke_ok{proto="h3",run_id="${RUN_ID}"} ${h3_ok}
# HELP och_gateway_protocol_smoke_failure_reason_info Outcome reason for last smoke (value 1).
# TYPE och_gateway_protocol_smoke_failure_reason_info gauge
EOF
  for _p in h1 h2 h3; do
    _ok_var="${_p}_ok"
    _r_var="${_p}_reason"
    _r="${!_r_var:-}"
    [[ "${!_ok_var:-0}" == "1" ]] && continue
    [[ -n "$_r" ]] || continue
    printf 'och_gateway_protocol_smoke_failure_reason_info{proto="%s",reason="%s",run_id="%s"} 1\n' "$_p" "$_r" "$RUN_ID"
  done
  cat <<EOF
# HELP och_gateway_h3_smoke_reason_info Legacy h3 reason gauge.
# TYPE och_gateway_h3_smoke_reason_info gauge
och_gateway_h3_smoke_reason_info{reason="${h3_reason:-unavailable}",run_id="${RUN_ID}"} 1
# HELP och_gateway_unknown_proto_ratio Instantaneous unknown/total from api-gateway (best-effort).
# TYPE och_gateway_unknown_proto_ratio gauge
och_gateway_unknown_proto_ratio{run_id="${RUN_ID}"} ${unknown_ratio}
EOF
} >"$prom"

chmod +x "$ROOT/scripts/lib/push-och-prom.sh" 2>/dev/null || true
OCH_PUSHGATEWAY_JOB=gateway-protocol-smoke OCH_PUSHGATEWAY_INSTANCE="$RUN_ID" \
  bash "$ROOT/scripts/lib/push-och-prom.sh" "$prom" || echo "obs-smoke-gateway-protocols: push failed (non-fatal)" >&2

exit_code=0
if [[ "$h1_ok" != 1 || "$h2_ok" != 1 ]]; then
  echo "obs-smoke-gateway-protocols: h1/h2 required probes failed" >&2
  exit_code=1
fi
if [[ "$client_h3_supported" == 1 && "$h3_ok" != 1 && "$ALLOW_H3_FAIL" != "1" ]]; then
  echo "obs-smoke-gateway-protocols: h3 required (client supports HTTP/3; set ALLOW_H3_FAIL=1 to waive)" >&2
  exit_code=1
fi

if [[ "$exit_code" == 0 ]]; then
  echo "obs-smoke-gateway-protocols: OK (h3=${h3_reason:-observed})"
else
  echo "obs-smoke-gateway-protocols: FAILED (h1=${h1_reason:-ok} h2=${h2_reason:-ok} h3=${h3_reason:-?})" >&2
fi
exit "$exit_code"
