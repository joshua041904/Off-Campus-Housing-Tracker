#!/usr/bin/env bash
# Golden-path trace contract: seed /api/debug/full-trace, poll Jaeger, validate all discovered *-service + api-gateway.
# Requires: curl, openssl, node, E2E_API_BASE (default https://off-campus-housing.test).
# Jaeger: JAEGER_QUERY_BASE, else bench_logs/.jaeger-query-base, else auto-probe 127.0.0.1:16686–16687 (+ JAEGER_PF_LOCAL_PORT), else kubectl svc/jaeger (then jaeger-query) LB or ClusterIP.
# TRACE_CONTRACT_DISABLE_LOCAL_JAEGER_PROBE=1 — skip localhost discovery (avoid wrong process on :16686).
# Skip (exit 0): TRACE_CONTRACT_SKIP=1 only.
# Env: TRACE_CONTRACT_REQUIRE_ALL_SERVICES=1 (default), TRACE_CONTRACT_LEGACY_SUBSET=1 for 5-service subset only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${TRACE_CONTRACT_SKIP:-0}" == "1" ]]; then
  echo "trace-contract-test: TRACE_CONTRACT_SKIP=1 — skipping"
  exit 0
fi

_och_jaeger_ok() {
  local base="${1%/}"
  curl -sfS --max-time 4 "${base}/api/services" 2>/dev/null | node -e "
    const d = require('fs').readFileSync(0, 'utf8');
    try {
      const j = JSON.parse(d);
      process.exit(Array.isArray(j.data) ? 0 : 1);
    } catch {
      process.exit(1);
    }
  " >/dev/null 2>&1
}

if [[ -z "${JAEGER_QUERY_BASE:-}" ]] && [[ -f "$ROOT/bench_logs/.jaeger-query-base" ]]; then
  _jb="$(tr -d '\r\n' <"$ROOT/bench_logs/.jaeger-query-base" | sed 's/[[:space:]]*$//')"
  if [[ -n "$_jb" ]] && _och_jaeger_ok "$_jb"; then
    export JAEGER_QUERY_BASE="$_jb"
    echo "trace-contract-test: JAEGER_QUERY_BASE from bench_logs/.jaeger-query-base → $JAEGER_QUERY_BASE"
  fi
fi

if [[ -z "${JAEGER_QUERY_BASE:-}" ]] && [[ "${TRACE_CONTRACT_DISABLE_LOCAL_JAEGER_PROBE:-0}" != "1" ]]; then
  for _port in "${JAEGER_PF_LOCAL_PORT:-16686}" 16686 16687 16685; do
    [[ -z "$_port" ]] && continue
    if _och_jaeger_ok "http://127.0.0.1:${_port}"; then
      export JAEGER_QUERY_BASE="http://127.0.0.1:${_port}"
      echo "trace-contract-test: auto-set JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (localhost probe)"
      break
    fi
  done
fi

if [[ -z "${JAEGER_QUERY_BASE:-}" ]] && command -v kubectl >/dev/null 2>&1; then
  _jq_kube_found=""
  for _ns in "${JAEGER_OBSERVABILITY_NS:-observability}" observability monitoring; do
    for _svc in jaeger jaeger-query; do
      _jq_ip="$(kubectl get svc -n "$_ns" "$_svc" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
      if [[ -z "$_jq_ip" ]]; then
        _jq_ip="$(kubectl get svc -n "$_ns" "$_svc" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
      fi
      if [[ -n "$_jq_ip" ]] && _och_jaeger_ok "http://${_jq_ip}:16686"; then
        export JAEGER_QUERY_BASE="http://${_jq_ip}:16686"
        echo "trace-contract-test: auto-set JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (kubectl ${_ns}/svc/${_svc})"
        _jq_kube_found=1
        break
      fi
    done
    [[ -n "$_jq_kube_found" ]] && break
  done
fi

if [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  echo "::error::trace-contract-test: Jaeger Query not reachable — JAEGER_QUERY_BASE unset and auto-discovery failed."
  echo "  1) export JAEGER_QUERY_BASE=https://off-campus-housing.test/jaeger   # Caddy → Jaeger (apply caddy-h3 ConfigMap + Jaeger QUERY_BASE_PATH=/jaeger)"
  echo "  2) kubectl port-forward -n observability svc/jaeger 16686:16686   # then re-run make trace-contract-full"
  echo "  3) export JAEGER_QUERY_BASE=http://127.0.0.1:16686"
  echo "  4) echo 'http://<lb>:16686' > bench_logs/.jaeger-query-base"
  echo "  Skip: TRACE_CONTRACT_SKIP=1"
  exit 1
fi

export TRACE_CONTRACT_REQUIRE_ALL_SERVICES="${TRACE_CONTRACT_REQUIRE_ALL_SERVICES:-1}"
export TRACE_LATENCY_BUDGETS_FILE="${TRACE_LATENCY_BUDGETS_FILE:-$ROOT/infra/trace_latency_budgets.json}"

TRACE_ID="$(openssl rand -hex 16)"
BASE="${E2E_API_BASE:-https://off-campus-housing.test}"
URL="${BASE%/}/api/debug/full-trace"

CA_ARGS=()
if [[ -f "$ROOT/certs/dev-root.pem" ]]; then
  CA_ARGS=(--cacert "$ROOT/certs/dev-root.pem")
else
  CA_ARGS=(-k)
fi

echo "▶ trace-contract: generating trace_id=$TRACE_ID"
_seed_http="$(curl -sS -o /dev/null -w "%{http_code}" "${CA_ARGS[@]}" "$URL" \
  -H "traceparent: 00-${TRACE_ID}-0000000000000001-01" \
  -H "x-debug-replay: contract-test" \
  -H "x-och-edge-proto: h3" \
  -H "x-suite: ${OCH_X_SUITE:-bash}")"
if [[ "${_seed_http}" != 2* ]]; then
  echo "::error::trace-contract: full-trace seed HTTP ${_seed_http} (expected 2xx)"
  echo "  URL=$URL"
  echo "  E2E_API_BASE=$BASE (set to cluster edge / gateway; rebuild image if /api/debug/full-trace missing)"
  exit 1
fi

echo "▶ trace-contract: waiting for Jaeger (${TRACE_CONTRACT_JAEGER_WAIT_SEC:-8}s)…"
sleep "${TRACE_CONTRACT_JAEGER_WAIT_SEC:-8}"

TRACE_JSON="${TRACE_CONTRACT_JSON_OUT:-$ROOT/bench_logs/trace_contract.json}"
mkdir -p "$(dirname "$TRACE_JSON")"
BASE_Q="${JAEGER_QUERY_BASE%/}"
_min_spans="${TRACE_CONTRACT_FETCH_MIN_SPANS:-8}"
_fetch_attempts="${TRACE_CONTRACT_FETCH_ATTEMPTS:-15}"
_span_n=0
for ((_i = 1; _i <= _fetch_attempts; _i++)); do
  if ! curl -sfS --max-time 45 "${BASE_Q}/api/traces/${TRACE_ID}" -o "$TRACE_JSON"; then
    echo "trace-contract: Jaeger GET /api/traces/${TRACE_ID} failed (attempt $_i/$_fetch_attempts)"
    sleep 2
    continue
  fi
  _span_n="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const t=Array.isArray(j.data)&&j.data[0]?j.data[0]:j;console.log((t.spans||[]).length)" "$TRACE_JSON")"
  if [[ "${_span_n:-0}" -ge ${_min_spans} ]]; then
    echo "▶ trace-contract: fetched trace ($_span_n spans, attempt $_i/$_fetch_attempts)"
    break
  fi
  echo "trace-contract: incomplete trace ($_span_n spans < $_min_spans), attempt $_i/$_fetch_attempts — sleep 2s"
  sleep 2
done
if [[ "${_span_n:-0}" -lt ${_min_spans} ]]; then
  echo "::error::trace-contract: trace never reached ≥${_min_spans} spans for trace_id=$TRACE_ID (got $_span_n)."
  echo "  Check: E2E_API_BASE reaches api-gateway with rebuilt image; Jaeger is the SAME cluster receiving OTLP; try TRACE_CONTRACT_JAEGER_WAIT_SEC=20"
  exit 1
fi

export TRACE_CONTRACT_REPORT_JSON="${TRACE_CONTRACT_REPORT_JSON:-$ROOT/bench_logs/trace_contract_report.json}"
node "$ROOT/scripts/validate-trace-contract.mjs" "$TRACE_JSON"

node "$ROOT/scripts/compute-trace-critical-path.mjs" "$TRACE_JSON" --json-out "$ROOT/bench_logs/trace_critical_path.json" >/dev/null

mkdir -p "$ROOT/bench_logs"
node "$ROOT/scripts/generate-trace-call-graph.mjs" "$TRACE_JSON" --json-out "$ROOT/bench_logs/trace_call_graph.json"
node "$ROOT/scripts/generate-trace-weighted-graph.mjs" "$TRACE_JSON" --json-out "$ROOT/bench_logs/trace_weighted_graph.json"
node "$ROOT/scripts/compute-trace-coverage.mjs" "$TRACE_JSON" --json-out "$ROOT/bench_logs/trace_coverage.json" || true
node "$ROOT/scripts/export-trace-coverage-prom.mjs" "$ROOT/bench_logs/trace_coverage.json" "$ROOT/bench_logs/trace_coverage.prom" || true
node "$ROOT/scripts/export-trace-graph-prom.mjs" || true
node "$ROOT/scripts/save-trace-edge-history.mjs" || true

if [[ "${TRACE_CONTRACT_STRICT_GRAPH:-1}" == "1" ]]; then
  node "$ROOT/scripts/detect-missing-trace-links.mjs" "$ROOT/bench_logs/trace_call_graph.json"
fi

if [[ "${TRACE_CONTRACT_ENFORCE_BASELINE:-0}" == "1" ]]; then
  node "$ROOT/scripts/enforce-edge-latency-baseline.mjs" || exit 1
fi

if [[ "${TRACE_CONTRACT_ANOMALY_STRICT:-0}" == "1" ]]; then
  node "$ROOT/scripts/detect-trace-anomalies.mjs" || exit 1
  node "$ROOT/scripts/export-trace-anomaly-prom.mjs" || true
fi

CP_MS="$(node -e "const j=require('./bench_logs/trace_critical_path.json');process.stdout.write(String(j.criticalPathMs||0))")"
EP="$(node -e "const j=require('./bench_logs/trace_critical_path.json');process.stdout.write(String(j.endpoint||''))")"
printf '%s\n' "{\"endpoint\":\"${EP}\",\"criticalPathMs\":${CP_MS},\"traceId\":\"${TRACE_ID}\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$ROOT/bench_logs/trace_history.jsonl"

{
  echo "trace_critical_path_ms ${CP_MS}"
  echo "trace_contract_pass 1"
} >> "$ROOT/bench_logs/trace.prom"

echo "✅ TRACE CONTRACT PASS (trace_id=$TRACE_ID report=$TRACE_CONTRACT_REPORT_JSON)"
