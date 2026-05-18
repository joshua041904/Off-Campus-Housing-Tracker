#!/usr/bin/env bash
# Bounded AI / listing-feel smoke → Pushgateway (drives analytics_latency histogram when Ollama responds).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
MAX_TIME="${OCH_AI_SMOKE_MAX_TIME:-25}"
# shellcheck source=scripts/lib/och-run-id.sh
source "$ROOT/scripts/lib/och-run-id.sh"
RUN_ID="${OCH_AI_SMOKE_RUN_ID:-$(och_read_run_id "$ROOT")}"

curl_args=(-sS --max-time "$MAX_TIME" -H "Content-Type: application/json")
if [[ -n "${CA_CERT:-}" ]]; then
  curl_args+=(--cacert "$CA_CERT")
else
  curl_args+=(-k)
fi

body='{"title":"OCH smoke","description":"smoke","price_cents":500000,"bedrooms":2,"bathrooms":1,"audience":"renter"}'
t0="$(python3 -c 'import time; print(time.time())')"
ok=0
degraded=0
http_code=000
if out="$(curl "${curl_args[@]}" -o /tmp/och-ai-smoke.json -w "\n%{http_code}" -X POST "$BASE_URL/api/analytics/insights/listing-feel-minimal" -d "$body" 2>&1)"; then
  http_code="$(echo "$out" | tail -1 | tr -d '\r\n[:space:]')"
  [[ "$http_code" == "200" ]] && ok=1
  if [[ "$http_code" == "200" ]] && grep -q '"degraded":true' /tmp/och-ai-smoke.json 2>/dev/null; then
    degraded=1
  fi
else
  http_code="000"
fi
t1="$(python3 -c 'import time; print(time.time())')"
dur="$(python3 -c "print(max(0.0, float('$t1')-float('$t0')))")"

prom="$ROOT/bench_logs/och-ai-smoke.prom"
mkdir -p "$(dirname "$prom")"
cat >"$prom" <<EOF
# HELP och_ai_smoke_success 1 if analytics listing-feel-minimal returned HTTP 200.
# TYPE och_ai_smoke_success gauge
och_ai_smoke_success{run_id="${RUN_ID}"} ${ok}
# HELP och_ai_smoke_duration_seconds Wall time for smoke request.
# TYPE och_ai_smoke_duration_seconds gauge
och_ai_smoke_duration_seconds{run_id="${RUN_ID}"} ${dur}
# HELP och_ai_smoke_degraded 1 if JSON body contained degraded:true.
# TYPE och_ai_smoke_degraded gauge
och_ai_smoke_degraded{run_id="${RUN_ID}"} ${degraded}
# HELP och_ai_smoke_http_code_info Last HTTP status (value 1).
# TYPE och_ai_smoke_http_code_info gauge
och_ai_smoke_http_code_info{code="${http_code}",run_id="${RUN_ID}"} 1
EOF

chmod +x "$ROOT/scripts/lib/push-och-prom.sh" 2>/dev/null || true
OCH_PUSHGATEWAY_JOB=ai-smoke OCH_PUSHGATEWAY_INSTANCE="$RUN_ID" \
  bash "$ROOT/scripts/lib/push-och-prom.sh" "$prom" || echo "obs-smoke-analytics: push failed" >&2

echo "obs-smoke-analytics: http=${http_code} ok=${ok} degraded=${degraded} dur=${dur}s"
