#!/usr/bin/env bash
# Wait for the public edge (/api/readyz) and run Playwright E2E (strict TLS, hostname only).
# Invokes scripts/webapp-playwright-strict-edge.sh → playwright test (webapp/e2e — multiple spec files).
# Optional: E2E_SCREENSHOTS=1 ./scripts/webapp-playwright-strict-edge.sh e2e/ui-screenshots.spec.ts → webapp/e2e/screenshots/*.png
# No kubectl port-forward; no http://127.0.0.1:4020 — legacy E2E_API_BASE values are ignored.
# PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC (default 30) acts as a cluster/edge idle-stability gate before tests run.
#
# Usage: ./scripts/run-playwright-e2e-preflight.sh
#   SKIP_PLAYWRIGHT_E2E=1  — exit 0 immediately
#   E2E_API_BASE           — must be https (default https://off-campus-housing.test)
#   NODE_EXTRA_CA_CERTS    — default REPO_ROOT/certs/dev-root.pem (for curl --cacert + Node TLS)
#   PLAYWRIGHT_VERTICAL_STRICT / PLAYWRIGHT_STRICT_HTTP3 — set by run-preflight-scale-and-all-suites.sh by default
#     (PREFLIGHT_PLAYWRIGHT_STRICT_HTTP3=1) for CI parity with webapp `test:e2e:strict-verticals-and-integrity`.
#   webapp-playwright-strict-edge.sh default (no args) runs that strict matrix (projects 06+07). PLAYWRIGHT_E2E_MATRIX=full → all projects.
#   JAEGER_QUERY_BASE — optional if discoverable: edge https://off-campus-housing.test/jaeger, JAEGER_PUBLIC_URL (MetalLB), or LB svc.
#     Probed before Playwright; observability
#     verification after tests: seed-jaeger-via-edge-health.sh + verify-jaeger-tracing-services.sh + verify-jaeger-trace-all-verticals.sh
#     + verify-jaeger-async-verticals.sh (Kafka flows from infra/observability/trace-flows.json; set JAEGER_VERIFY_ASYNC_VERTICALS=0 to skip).
#     Jaeger steps run even when Playwright fails unless SKIP_JAEGER_AFTER_PLAYWRIGHT_FAIL=1 (ignored when PREFLIGHT_STRICT_EXIT=1).
#   TRACE_VALIDATION_REPORT_DIR — output dir for trace-validation-report.json, .md, alerts, trace_flow_validation.prom
#     (default: $PREFLIGHT_RUN_DIR/trace-validation or bench_logs/trace-validation-<timestamp>).
#   TRACE_VALIDATION_REPORT_DISABLED=1 — skip writing machine-readable trace reports.
#   PREFLIGHT_STRICT_EXIT=1 — seed-jaeger-via-edge-health.sh failure exits immediately (fatal); final exit is non-zero if Playwright OR any Jaeger step failed.
#   OTEL_PREFLIGHT_TRACE_SAMPLE=1 — after seed, curl Jaeger /api/traces for api-gateway and booking-service and print traceID + span counts (needs jq).
#   PLAYWRIGHT_WORKERS — webapp-playwright-strict-edge.sh defaults to 2 (override e.g. 4 for faster local runs when edge is quiet).
#   Kafka readiness (optional; set when E2E stack includes a broker):
#     PLAYWRIGHT_WAIT_KAFKA_CONTAINER — docker container name/id with State.Health (e.g. compose kafka-1)
#     PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT — kubectl deployment name; runs kubectl wait --for=condition=available
#   Post–load-k6 recovery (avoid Playwright against a degraded edge):
#     PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC — default 30; require this many consecutive-success seconds of polling
#       (any failed curl resets the accumulator). Set 0 to skip (legacy: first 200 only).
#     PLAYWRIGHT_EDGE_RECOVERY_POLL_SEC — sleep between probes (default 2).
#     PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL — optional second URL (full https URL) that must also return 2xx each poll.
#     PLAYWRIGHT_EDGE_RECOVERY_INCLUDE_LISTINGS_HEALTH — default 1 when unset: also probe ${E2E_API_BASE}/api/listings/healthz
#       during recovery (set 0 to disable unless PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL is set).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

[[ "${SKIP_PLAYWRIGHT_E2E:-0}" == "1" ]] && { warn "SKIP_PLAYWRIGHT_E2E=1"; exit 0; }

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"

if [[ ! -s "$CA" ]]; then
  warn "Missing CA at $CA — sync certs/dev-root.pem (preflight) or set NODE_EXTRA_CA_CERTS"
  exit 1
fi

E2E_API_BASE="$(edge_normalize_e2e_api_base)" || exit 1
edge_require_host_resolves "$E2E_API_BASE" || exit 1

unset API_GATEWAY_INTERNAL

export NODE_EXTRA_CA_CERTS="$CA"
export E2E_API_BASE
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"

export REPO_ROOT="$REPO_ROOT"
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh" ]] && source "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh"
if command -v och_jaeger_resolve_query_base >/dev/null 2>&1; then
  och_jaeger_resolve_query_base || true
fi
if [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  echo "[preflight] JAEGER_QUERY_BASE unset after discovery — set JAEGER_PUBLIC_URL, export JAEGER_QUERY_BASE, or apply Caddy /jaeger + Jaeger QUERY_BASE_PATH (see scripts/lib/jaeger-resolve-query-base.sh)" >&2
  exit 1
fi
export TRACE_LOOKBACK_SECONDS=180
export JAEGER_VERIFY_TRACE_STRUCTURE=1

_stability_timeout="${PREFLIGHT_STABILITY_WAIT_TIMEOUT_SEC:-90s}"
_ensure_cluster_stability() {
  if [[ "${PREFLIGHT_RUN_CLUSTER_STABILITY_GUARD:-1}" == "1" ]] && [[ -x "$SCRIPT_DIR/cluster-stability-guard.sh" ]]; then
    "$SCRIPT_DIR/cluster-stability-guard.sh"
  fi

  if [[ "${PREFLIGHT_ENSURE_METRICS_SERVER:-1}" == "1" ]] && [[ -x "$SCRIPT_DIR/ensure-metrics-server-ready.sh" ]]; then
    say "Cluster stability: metrics-server readiness"
    if ! "$SCRIPT_DIR/ensure-metrics-server-ready.sh"; then
      if [[ "${PREFLIGHT_STRICT_EXIT:-0}" == "1" ]]; then
        echo "[preflight] metrics-server readiness failed (strict mode)." >&2
        exit 1
      fi
      warn "metrics-server readiness failed; continuing (set PREFLIGHT_STRICT_EXIT=1 to hard fail)"
    fi
  fi

  say "Cluster stability: waiting for api-gateway and jaeger pods Ready"
  kubectl wait --for=condition=ready pod -l app=api-gateway -n off-campus-housing-tracker --timeout="${_stability_timeout}"
  kubectl wait --for=condition=ready pod -l app=auth-service -n off-campus-housing-tracker --timeout="${_stability_timeout}"
  kubectl wait --for=condition=ready pod -l app=jaeger -n observability --timeout="${_stability_timeout}"
  ok "Cluster stability barrier passed (api-gateway + auth-service + jaeger Ready)"
}

_ensure_cluster_stability

if [[ "${TRACE_VALIDATION_REPORT_DISABLED:-0}" != "1" ]]; then
  if [[ -z "${TRACE_VALIDATION_REPORT_DIR:-}" ]]; then
    if [[ -n "${PREFLIGHT_RUN_DIR:-}" ]]; then
      TRACE_VALIDATION_REPORT_DIR="${PREFLIGHT_RUN_DIR}/trace-validation"
    else
      TRACE_VALIDATION_REPORT_DIR="$REPO_ROOT/bench_logs/trace-validation-$(date +%Y%m%d-%H%M%S)"
    fi
  fi
  export TRACE_VALIDATION_REPORT_DIR
  mkdir -p "$TRACE_VALIDATION_REPORT_DIR"
  info "Trace validation report dir: $TRACE_VALIDATION_REPORT_DIR"
else
  unset TRACE_VALIDATION_REPORT_DIR 2>/dev/null || true
fi

if [[ -n "${PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL:-}" ]]; then
  :
elif [[ "${PLAYWRIGHT_EDGE_RECOVERY_INCLUDE_LISTINGS_HEALTH:-1}" == "1" ]]; then
  PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL="${E2E_API_BASE}/api/listings/healthz"
  export PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL
fi

# Chromium for CI/local
if [[ -d "$REPO_ROOT/webapp/node_modules/@playwright/test" ]]; then
  (cd "$REPO_ROOT/webapp" && pnpm exec playwright install chromium) 2>/dev/null || true
fi

READY_URL="${E2E_API_BASE}/api/readyz"
EXTRA_URL="${PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL:-}"
[[ -n "$EXTRA_URL" ]] && info "Playwright edge extra probe: $EXTRA_URL"

if [[ -n "${PLAYWRIGHT_WAIT_KAFKA_CONTAINER:-}" ]]; then
  say "Waiting for Kafka container health (${PLAYWRIGHT_WAIT_KAFKA_CONTAINER})..."
  kafka_ok=0
  for _k in $(seq 1 90); do
    st="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${PLAYWRIGHT_WAIT_KAFKA_CONTAINER}" 2>/dev/null || echo missing)"
    if [[ "$st" == "healthy" ]]; then
      ok "Kafka container healthy (${PLAYWRIGHT_WAIT_KAFKA_CONTAINER})"
      kafka_ok=1
      break
    fi
    sleep 2
  done
  if [[ "$kafka_ok" != "1" ]]; then
    warn "Kafka container did not become healthy (set PLAYWRIGHT_WAIT_KAFKA_CONTAINER only for compose/k8s-local with a healthcheck)"
    exit 1
  fi
fi

if [[ -n "${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT:-}" ]]; then
  say "Waiting for Kafka deployment (${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT})..."
  kubectl wait --for=condition=available "deployment/${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT}" --timeout=120s
  ok "Kafka deployment available"
fi

_curl_ok() {
  local u="$1"
  curl -sf --cacert "$CA" --max-time 5 \
    -H "x-traffic-class: infra" -H "x-suite: ${OCH_X_SUITE}" \
    "$u" >/dev/null 2>&1
}

_all_probes_ok() {
  _curl_ok "$READY_URL" || return 1
  if [[ -n "$EXTRA_URL" ]]; then
    _curl_ok "$EXTRA_URL" || return 1
  fi
  return 0
}

say "Playwright E2E: waiting for edge $READY_URL (TLS verify with CA=$CA)"
EDGE_OK=0
for _i in $(seq 1 60); do
  if _all_probes_ok; then
    ok "Edge reachable ($READY_URL${EXTRA_URL:+ + extra probe})"
    EDGE_OK=1
    break
  fi
  sleep 2
done
if [[ "$EDGE_OK" != "1" ]]; then
  warn "Edge did not become ready at $READY_URL"
  echo "Verify: curl --cacert \"$CA\" \"$READY_URL\"  (expect HTTP 200)" >&2
  [[ -n "$EXTRA_URL" ]] && echo "Extra probe: curl --cacert \"$CA\" \"$EXTRA_URL\"" >&2
  exit 1
fi

STABLE_SEC="${PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC:-30}"
POLL_SEC="${PLAYWRIGHT_EDGE_RECOVERY_POLL_SEC:-2}"
if [[ "${STABLE_SEC:-0}" =~ ^[0-9]+$ ]] && [[ "$STABLE_SEC" -gt 0 ]]; then
  say "Playwright recovery barrier: need ${STABLE_SEC}s consecutive OK (poll ${POLL_SEC}s; any failure resets)${EXTRA_URL:+; extra URL probe}"
  accum=0
  barrier_deadline=$(( $(date +%s) + 900 ))
  while true; do
    now=$(date +%s)
    if [[ "$now" -ge "$barrier_deadline" ]]; then
      warn "Recovery barrier timed out after 900s (still not stable ${STABLE_SEC}s)"
      exit 1
    fi
    if _all_probes_ok; then
      accum=$((accum + POLL_SEC))
      if [[ "$accum" -ge "$STABLE_SEC" ]]; then
        ok "Recovery barrier satisfied (${STABLE_SEC}s stable)"
        break
      fi
    else
      accum=0
    fi
    sleep "$POLL_SEC"
  done
else
  info "PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC=0 — skipping sustained recovery barrier (first OK only)"
fi

# Default: strict verticals + system integrity (06+07). PLAYWRIGHT_E2E_MATRIX=full → all projects via strict-edge script.
say "Running: webapp-playwright-strict-edge.sh → strict-verticals-and-integrity (or PLAYWRIGHT_E2E_MATRIX=full)"
chmod +x "$SCRIPT_DIR/webapp-playwright-strict-edge.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/verify-jaeger-tracing-services.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/verify-jaeger-trace-structure.sh" "$SCRIPT_DIR/verify-jaeger-trace-all-verticals.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/verify-jaeger-async-verticals.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/seed-jaeger-via-edge-health.sh" 2>/dev/null || true

_pw_rc=0
"$SCRIPT_DIR/webapp-playwright-strict-edge.sh" || _pw_rc=$?
if [[ "$_pw_rc" != "0" ]]; then
  warn "Playwright E2E exited $_pw_rc — still running Jaeger seed + verification (set SKIP_JAEGER_AFTER_PLAYWRIGHT_FAIL=1 to opt out)"
fi

# Strict runs always aggregate Playwright + Jaeger + async (no early exit that hides Jaeger failures).
if [[ "${SKIP_JAEGER_AFTER_PLAYWRIGHT_FAIL:-0}" == "1" ]] && [[ "$_pw_rc" != "0" ]] && [[ "${PREFLIGHT_STRICT_EXIT:-0}" != "1" ]]; then
  warn "SKIP_JAEGER_AFTER_PLAYWRIGHT_FAIL=1 — skipping Jaeger seed/verify"
  exit "$_pw_rc"
fi

say "OTEL seed: gateway health fan-out (seed-jaeger-via-edge-health.sh)"
_seed_rc=0
"$SCRIPT_DIR/seed-jaeger-via-edge-health.sh" || _seed_rc=$?
if [[ "$_seed_rc" != "0" ]]; then
  warn "seed-jaeger-via-edge-health.sh exited $_seed_rc"
  if [[ "${PREFLIGHT_STRICT_EXIT:-0}" == "1" ]]; then
    echo "[preflight] PREFLIGHT_STRICT_EXIT=1 — seed failure is fatal" >&2
    exit "$_seed_rc"
  fi
fi

if [[ "${OTEL_PREFLIGHT_TRACE_SAMPLE:-0}" == "1" ]]; then
  say "DEBUG TRACE SAMPLE (OTEL_PREFLIGHT_TRACE_SAMPLE=1)"
  _jq_base="${JAEGER_QUERY_BASE%/}"
  if command -v jq >/dev/null 2>&1; then
    echo "=== api-gateway (limit=5): traceID + span count ==="
    curl -sS "${_jq_base}/api/traces?service=api-gateway&limit=5" | jq -r '.data[]? | "traceID=\(.traceID) spans=\(.spans | length)"' || true
    echo "=== booking-service (limit=5): traceID + span count ==="
    curl -sS "${_jq_base}/api/traces?service=booking-service&limit=5" | jq -r '.data[]? | "traceID=\(.traceID) spans=\(.spans | length)"' || true
  else
    warn "jq not found — raw trace JSON snippets (truncated)"
    curl -sS "${_jq_base}/api/traces?service=api-gateway&limit=5" | head -c 4000 || true
    echo ""
    curl -sS "${_jq_base}/api/traces?service=booking-service&limit=5" | head -c 4000 || true
  fi
fi

say "Jaeger observability contract: verify-jaeger-tracing-services.sh"
_jaeger_svc_rc=0
if [[ -x "$SCRIPT_DIR/verify-jaeger-liveness.sh" ]]; then
  "$SCRIPT_DIR/verify-jaeger-liveness.sh" || _jaeger_svc_rc=$?
fi
JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" "$SCRIPT_DIR/verify-jaeger-tracing-services.sh" || _jaeger_svc_rc=$?
if [[ -n "${TRACE_VALIDATION_REPORT_DIR:-}" ]]; then
  _reg_msg="verify-jaeger-tracing-services.sh exit ${_jaeger_svc_rc}"
  JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" node "$SCRIPT_DIR/verify-jaeger-trace-flows.mjs" \
    --report-dir "$TRACE_VALIDATION_REPORT_DIR" \
    --record-registry "${_jaeger_svc_rc}" \
    --registry-message "${_reg_msg}" || true
fi
if [[ "$_jaeger_svc_rc" != "0" ]]; then
  warn "verify-jaeger-tracing-services.sh failed"
fi

say "Jaeger structural traces — deterministic strict-suite verticals (verify-jaeger-trace-all-verticals.sh)"
_jaeger_struct_rc=0
JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" "$SCRIPT_DIR/verify-jaeger-trace-all-verticals.sh" || _jaeger_struct_rc=$?
if [[ "$_jaeger_struct_rc" != "0" ]]; then
  warn "verify-jaeger-trace-all-verticals.sh failed"
fi

_jaeger_async_rc=0
if [[ "${JAEGER_VERIFY_ASYNC_VERTICALS:-1}" != "0" ]]; then
  say "Jaeger async verticals — Kafka producer/consumer flows (verify-jaeger-async-verticals.sh)"
  JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" "$SCRIPT_DIR/verify-jaeger-async-verticals.sh" || _jaeger_async_rc=$?
  if [[ "$_jaeger_async_rc" != "0" ]]; then
    warn "verify-jaeger-async-verticals.sh failed"
  fi
else
  info "JAEGER_VERIFY_ASYNC_VERTICALS=0 — skipping async Jaeger flows"
fi

_final=0
[[ "${_seed_rc:-0}" != "0" ]] && _final=1
[[ "$_jaeger_svc_rc" != "0" ]] && _final=1
[[ "$_jaeger_struct_rc" != "0" ]] && _final=1
[[ "$_jaeger_async_rc" != "0" ]] && _final=1
[[ "$_pw_rc" != "0" ]] && _final=1

if [[ "$_final" == "0" ]]; then
  ok "Playwright E2E + Jaeger verification finished"
else
  warn "Finished with failures: playwright_rc=$_pw_rc seed_rc=${_seed_rc:-0} jaeger_services_rc=$_jaeger_svc_rc jaeger_struct_rc=$_jaeger_struct_rc jaeger_async_rc=$_jaeger_async_rc"
  exit 1
fi
