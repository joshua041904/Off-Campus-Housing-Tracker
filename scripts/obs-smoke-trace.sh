#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
JAEGER_BASE="${JAEGER_BASE:-$BASE_URL/jaeger}"
LOOKBACK_RETRIES="${LOOKBACK_RETRIES:-12}"
SLEEP_SECS="${SLEEP_SECS:-3}"
REQUIRED_SERVICES="${REQUIRED_SERVICES:-api-gateway,booking-service,listings-service,notification-service}"
MIN_SERVICES="${MIN_SERVICES:-3}"
MIN_SPANS="${MIN_SPANS:-8}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"
RUN_ID="${OCH_TRACE_SMOKE_RUN_ID:-$(och_read_run_id "$ROOT")}"

curl_args=(-sS)
if [[ -n "${CA_CERT:-}" ]]; then
  curl_args+=(--cacert "$CA_CERT")
else
  curl_args+=(-k)
fi

tmp_resp="$(mktemp "${TMPDIR:-/tmp}/och-trace-smoke-response.XXXXXX.json")"
tmp_trace="$(mktemp "${TMPDIR:-/tmp}/och-trace-smoke-jaeger.XXXXXX.json")"
tmp_prom="$(mktemp "${TMPDIR:-/tmp}/och-trace-smoke.prom.XXXXXX")"
cleanup() {
  rm -f "$tmp_resp" "$tmp_trace" "$tmp_prom"
}
trap cleanup EXIT

wall0_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"

echo "== Trigger full-trace smoke route =="
curl "${curl_args[@]}" "$BASE_URL/api/debug/full-trace" -o "$tmp_resp"
cat "$tmp_resp"
echo

trace_id="$(
  python3 - "$tmp_resp" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    body = json.load(fh)
print(body.get('trace_id') or '')
PY
)"

if [[ -z "$trace_id" ]]; then
  echo "obs-smoke-trace: response did not include trace_id" >&2
  exit 1
fi

echo "trace_id=$trace_id"
echo "Jaeger: ${JAEGER_BASE}/trace/${trace_id}"

span_count=0
service_count=0
non_2xx=0
jaeger_ok=0

echo "== Query Jaeger for trace =="
for attempt in $(seq 1 "$LOOKBACK_RETRIES"); do
  if curl "${curl_args[@]}" "$JAEGER_BASE/api/traces/$trace_id" -o "$tmp_trace"; then
  eval "$(python3 - "$tmp_trace" "$REQUIRED_SERVICES" "$MIN_SERVICES" "$MIN_SPANS" <<'PY'
import json, sys
trace_path, required_raw, min_svc, min_spans = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
required = [x.strip() for x in required_raw.split(',') if x.strip()]
with open(trace_path, 'r', encoding='utf-8') as fh:
    body = json.load(fh)
data = body.get('data') or []
if not data:
    print("span_count=0 service_count=0 non_2xx=0 jaeger_ok=0")
    raise SystemExit(0)
trace = data[0]
processes = trace.get('processes') or {}
spans = trace.get('spans') or []
services = sorted({
    processes.get(span.get('processID'), {}).get('serviceName')
    for span in spans
    if processes.get(span.get('processID'), {}).get('serviceName')
})
missing = [svc for svc in required if svc not in services]
non_2xx = sum(1 for s in spans if any(t.get('key') == 'error' and t.get('value') for t in (s.get('tags') or [])))
ok = 0 if missing or len(services) < min_svc or len(spans) < min_spans else 1
print(f"span_count={len(spans)} service_count={len(services)} non_2xx={non_2xx} jaeger_ok={ok}")
PY
)"
    if [[ "$jaeger_ok" == "1" ]]; then
      echo "== Jaeger trace OK: services=$service_count spans=$span_count =="
      cat "$tmp_trace"
      break
    fi
  fi
  sleep "$SLEEP_SECS"
done

wall1_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"
dur_sec="$(python3 - "$wall0_ms" "$wall1_ms" <<'PY'
import sys
print(max(0, (int(sys.argv[2]) - int(sys.argv[1])) / 1000.0))
PY
)"
ts_now="$(python3 -c 'import time; print(int(time.time()))')"

if [[ "$jaeger_ok" != "1" ]]; then
  echo "obs-smoke-trace: trace $trace_id did not meet gates (services>=$MIN_SERVICES spans>=$MIN_SPANS required=$REQUIRED_SERVICES)" >&2
  span_count="${span_count:-0}"
  service_count="${service_count:-0}"
fi

cat >"$tmp_prom" <<EOF
# HELP och_trace_smoke_span_count Spans in Jaeger for last full-trace smoke.
# TYPE och_trace_smoke_span_count gauge
och_trace_smoke_span_count{run_id="${RUN_ID}"} ${span_count:-0}
# HELP och_trace_smoke_service_count Distinct services in last full-trace smoke trace.
# TYPE och_trace_smoke_service_count gauge
och_trace_smoke_service_count{run_id="${RUN_ID}"} ${service_count:-0}
# HELP och_trace_smoke_non_2xx_count Non-2xx or error-tagged spans in last smoke trace.
# TYPE och_trace_smoke_non_2xx_count gauge
och_trace_smoke_non_2xx_count{run_id="${RUN_ID}"} ${non_2xx:-0}
# HELP och_trace_smoke_last_success_timestamp_seconds Unix time when smoke passed Jaeger gates.
# TYPE och_trace_smoke_last_success_timestamp_seconds gauge
och_trace_smoke_last_success_timestamp_seconds{run_id="${RUN_ID}"} $([[ "$jaeger_ok" == "1" ]] && echo "$ts_now" || echo 0)
# HELP och_trace_smoke_duration_seconds Wall time for smoke script including Jaeger poll.
# TYPE och_trace_smoke_duration_seconds gauge
och_trace_smoke_duration_seconds{run_id="${RUN_ID}"} ${dur_sec}
# HELP och_trace_smoke_last_trace_id_info Last trace id (value 1).
# TYPE och_trace_smoke_last_trace_id_info gauge
och_trace_smoke_last_trace_id_info{trace_id="${trace_id}",run_id="${RUN_ID}"} 1
EOF

cp "$tmp_prom" "$ROOT/bench_logs/och-trace-smoke.prom"
chmod +x "$ROOT/scripts/lib/push-och-prom.sh" 2>/dev/null || true
OCH_PUSHGATEWAY_JOB=trace-smoke OCH_PUSHGATEWAY_INSTANCE="$RUN_ID" \
  bash "$ROOT/scripts/lib/push-och-prom.sh" "$tmp_prom" || echo "obs-smoke-trace: pushgateway push failed (non-fatal)" >&2

[[ "$jaeger_ok" == "1" ]] || exit 1
echo "obs-smoke-trace: OK (pushed metrics, duration=${dur_sec}s)"
