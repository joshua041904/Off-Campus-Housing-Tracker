#!/usr/bin/env bash
# Sweep VUs per service/protocol to estimate collapse ceilings and queue amplification.
#
# Usage (repo root):
#   ./scripts/load/run-service-ceiling.sh
#   SERVICES="trust messaging" PROTOCOLS="http3,http2,http1" VUS_STEPS="10,20,30,40,50,60" DURATION=60s ./scripts/load/run-service-ceiling.sh
#
# Output:
#   bench_logs/ceiling/<stamp>/
#     results.csv
#     <service>/<protocol>/vus-<n>-summary.json
#     <service>/<protocol>/vus-<n>.log
#     <service>/<protocol>/pg-peak-vus-<n>.txt   (DB-backed services only, best-effort)
#
# Collapse rule (default):
#   p95 >= CEILING_COLLAPSE_P95_MS (1000) OR fail_rate >= CEILING_COLLAPSE_FAIL_RATE (0.01)
#   OR rps growth stalls (< CEILING_MIN_RPS_GROWTH, default 0.03) for 2 consecutive steps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

SERVICES_RAW="${SERVICES:-trust,messaging,listings,booking,auth,gateway,analytics,media,event-layer}"
PROTOCOLS_RAW="${PROTOCOLS:-http3,http2,http1}"
VUS_STEPS_RAW="${VUS_STEPS:-10,20,30,40,50,60}"
DURATION="${DURATION:-60s}"
CEILING_COLLAPSE_P95_MS="${CEILING_COLLAPSE_P95_MS:-1000}"
CEILING_COLLAPSE_FAIL_RATE="${CEILING_COLLAPSE_FAIL_RATE:-0.01}"
CEILING_MIN_RPS_GROWTH="${CEILING_MIN_RPS_GROWTH:-0.03}"
CEILING_PG_SNAPSHOT_INTERVAL="${CEILING_PG_SNAPSHOT_INTERVAL:-2}"
CEILING_ENSURE_HTTP3="${CEILING_ENSURE_HTTP3:-1}"
CEILING_DERIVE_MODEL="${CEILING_DERIVE_MODEL:-1}"

STAMP="${CEILING_STAMP:-$(date +%Y%m%d-%H%M%S)}"
OUT_BASE="${CEILING_OUT_BASE:-$REPO_ROOT/bench_logs/ceiling/$STAMP}"
mkdir -p "$OUT_BASE"

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

IFS=',' read -r -a SERVICES <<<"$SERVICES_RAW"
IFS=',' read -r -a PROTOCOLS <<<"$PROTOCOLS_RAW"
IFS=',' read -r -a VUS_STEPS <<<"$VUS_STEPS_RAW"

_db_for_service() {
  case "$1" in
    auth) echo "auth:5441" ;;
    listings) echo "listings:5442" ;;
    booking) echo "bookings:5443" ;;
    messaging) echo "messaging:5444" ;;
    trust) echo "trust:5446" ;;
    analytics) echo "analytics:5447" ;;
    media) echo "media:5448" ;;
    *) echo "" ;;
  esac
}

_run_cell() {
  local service="$1" proto="$2" vus="$3" out_dir="$4"
  local cell_out="$out_dir/vus-$vus-run"
  mkdir -p "$cell_out"
  K6_MATRIX_OUT="$cell_out" \
    K6_MATRIX_ENSURE_HTTP3="$CEILING_ENSURE_HTTP3" \
    DURATION="$DURATION" \
    VUS="$vus" \
    "$SCRIPT_DIR/run-k6-protocol-matrix.sh" "$proto" "$service" >/dev/null 2>&1 || true
}

_extract_metrics() {
  local summary="$1"
  python3 - "$summary" <<'PY'
import json,sys
fp=sys.argv[1]
try:
  d=json.load(open(fp))
except Exception:
  print(",,,1,missing_summary,,,,")
  raise SystemExit(0)
if "metrics" not in d:
  err=d.get("error","non_metric_summary")
  print(f",,,,,1,{err},,,,{d.get('k6_matrix_status','')}")
  raise SystemExit(0)
m=d["metrics"]
def val(metric,key):
  return (((m.get(metric) or {}).get(key)))
p50=(val("http_req_waiting","med") or val("http3_req_waiting","med") or
     val("http_req_duration","med") or val("http3_req_duration","med") or "")
p95=(val("http_req_waiting","p(95)") or val("http3_req_waiting","p(95)") or
     val("http_req_duration","p(95)") or val("http3_req_duration","p(95)") or "")
p99=(val("http_req_waiting","p(99)") or val("http3_req_waiting","p(99)") or
     val("http_req_duration","p(99)") or val("http3_req_duration","p(99)") or "")
avg=(val("http_req_waiting","avg") or val("http3_req_waiting","avg") or
     val("http_req_duration","avg") or val("http3_req_duration","avg") or "")
maxv=(val("http_req_waiting","max") or val("http3_req_waiting","max") or
      val("http_req_duration","max") or val("http3_req_duration","max") or "")
rps=val("http_reqs","rate") or val("http3_reqs","rate") or ""
fail=(m.get("http_req_failed") or {}).get("value","")
status=d.get("k6_matrix_status","ok")
warn=d.get("k6_matrix_warning","")
print(f"{p50},{p95},{p99},{avg},{maxv},{rps},{fail},{status},{warn}")
PY
}

echo "service,protocol,vus,duration,p50_waiting_ms,p95_waiting_ms,p99_waiting_ms,avg_waiting_ms,max_waiting_ms,rps,fail_rate,collapse,reason,pg_peak_connections,summary,log" >"$OUT_BASE/results.csv"
echo "Ceiling run output: $OUT_BASE"

for service in "${SERVICES[@]}"; do
  [[ -n "$service" ]] || continue
  for proto in "${PROTOCOLS[@]}"; do
    [[ -n "$proto" ]] || continue
    proto_dir="$OUT_BASE/$service/$proto"
    mkdir -p "$proto_dir"
    prev_rps=""
    stall_count=0
    collapsed=0
    for vus in "${VUS_STEPS[@]}"; do
      [[ "$collapsed" == "1" ]] && break
      [[ -n "$vus" ]] || continue

      dbspec="$(_db_for_service "$service")"
      peak_file="$proto_dir/pg-peak-vus-$vus.txt"
      pg_peak=""
      sampler_pid=""
      if [[ -n "$dbspec" ]] && [[ "$CEILING_PG_SNAPSHOT_INTERVAL" != "0" ]] && command -v psql >/dev/null 2>&1; then
        db_name="${dbspec%%:*}"
        db_port="${dbspec##*:}"
        (
          peak=0
          while true; do
            c=$(psql -h "$PGHOST" -p "$db_port" -U "$PGUSER" -d "$db_name" -Atqc "SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database();" 2>/dev/null || echo 0)
            case "$c" in
              ''|*[!0-9]*) c=0 ;;
            esac
            if [[ "$c" -gt "$peak" ]]; then peak="$c"; fi
            echo "$peak" >"$peak_file"
            sleep "$CEILING_PG_SNAPSHOT_INTERVAL"
          done
        ) &
        sampler_pid=$!
      fi

      _run_cell "$service" "$proto" "$vus" "$proto_dir"
      [[ -n "$sampler_pid" ]] && kill "$sampler_pid" 2>/dev/null || true
      [[ -n "$sampler_pid" ]] && wait "$sampler_pid" 2>/dev/null || true

      summary_src="$proto_dir/vus-$vus-run/$proto/${service}-summary.json"
      log_src="$proto_dir/vus-$vus-run/k6-matrix-logs/${proto}-${service}.log"
      summary_out="$proto_dir/vus-$vus-summary.json"
      log_out="$proto_dir/vus-$vus.log"
      [[ -f "$summary_src" ]] && cp -f "$summary_src" "$summary_out" || true
      [[ -f "$log_src" ]] && cp -f "$log_src" "$log_out" || true

      IFS=',' read -r p50 p95 p99 avg maxv rps fail status warn <<<"$(_extract_metrics "$summary_out")"
      collapse=0
      reason=""
      if [[ -z "$p95" ]]; then
        collapse=1
        reason="${status:-no_metrics}"
      else
        if awk -v p="$p95" -v lim="$CEILING_COLLAPSE_P95_MS" 'BEGIN{exit !((p+0) >= (lim+0))}'; then
          collapse=1; reason="p95>=${CEILING_COLLAPSE_P95_MS}"
        fi
        if awk -v f="$fail" -v lim="$CEILING_COLLAPSE_FAIL_RATE" 'BEGIN{exit !((f+0) >= (lim+0))}'; then
          collapse=1; reason="${reason:+$reason|}fail_rate>=${CEILING_COLLAPSE_FAIL_RATE}"
        fi
        if [[ -n "$prev_rps" ]] && [[ -n "$rps" ]]; then
          if awk -v a="$prev_rps" -v b="$rps" -v g="$CEILING_MIN_RPS_GROWTH" 'BEGIN{ if (a<=0) exit 1; growth=(b-a)/a; exit !(growth < g) }'; then
            stall_count=$((stall_count + 1))
          else
            stall_count=0
          fi
          if [[ "$stall_count" -ge 2 ]]; then
            collapse=1; reason="${reason:+$reason|}rps_stall"
          fi
        fi
      fi
      prev_rps="$rps"

      pg_peak=""
      [[ -f "$peak_file" ]] && pg_peak="$(cat "$peak_file" 2>/dev/null || true)"
      echo "$service,$proto,$vus,$DURATION,$p50,$p95,$p99,$avg,$maxv,$rps,$fail,$collapse,$reason,$pg_peak,$summary_out,$log_out" >>"$OUT_BASE/results.csv"

      if [[ "$collapse" == "1" ]]; then
        collapsed=1
        echo "collapse: service=$service protocol=$proto vus=$vus reason=$reason"
      fi
    done
  done
done

echo ""
echo "Wrote: $OUT_BASE/results.csv"
echo "Output dir: $OUT_BASE"
if [[ "$CEILING_DERIVE_MODEL" == "1" ]] && command -v node >/dev/null 2>&1; then
  if SERVICE_MODEL_OUT="$OUT_BASE/service-model.json" node "$SCRIPT_DIR/derive-service-model.js" "$OUT_BASE/results.csv" >/dev/null 2>&1; then
    echo "Wrote: $OUT_BASE/service-model.json"
  else
    echo "warn: derive-service-model.js failed for $OUT_BASE/results.csv (set CEILING_DERIVE_MODEL=0 to skip)" >&2
  fi
  if node "$SCRIPT_DIR/summarize-ceiling-matrix.js" "$OUT_BASE/results.csv" >/dev/null 2>&1; then
    echo "Wrote: $OUT_BASE/protocol-side-by-side.csv"
    echo "Wrote: $OUT_BASE/protocol-anomalies.csv"
  else
    echo "warn: summarize-ceiling-matrix.js failed for $OUT_BASE/results.csv" >&2
  fi
fi
