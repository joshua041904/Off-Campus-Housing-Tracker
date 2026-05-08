#!/usr/bin/env bash
# Application runtime readiness: infra/app_runtime_services.json → rollout + per-service health
# (HTTP GET in-pod, gRPC Health/Check via same grpc_health_probe as K8s, or `auto`: HTTP then gRPC).
# Services are checked in parallel; results go to bench_logs/app_runtime_metrics.prom.
# Consumed by verify-bootstrap-state (phase app_runtime) and `make verify-app-runtime`.
#
# Env:
#   VERIFY_APP_RUNTIME_CONFIG — path to JSON (default: $REPO_ROOT/infra/app_runtime_services.json)
#   VERIFY_APP_RUNTIME_PROM_OUT — path for .prom output (default: $REPO_ROOT/bench_logs/app_runtime_metrics.prom)
#   VERIFY_APP_RUNTIME_MODE — set to "ci" for fail-fast gates (lower retries/backoff caps, shorter rollout/health timeouts)
#   VERIFY_APP_RUNTIME_PHASE — cold | warm | unknown (default unknown); cold-bootstrap sets cold via Makefile for history deltas
#   VERIFY_APP_RUNTIME_HISTORY — JSONL append path (default: $REPO_ROOT/bench_logs/app_runtime_history.jsonl); VERIFY_APP_RUNTIME_SKIP_HISTORY=1 disables
#   HOUSING_NS / NAMESPACE — override config .namespace when set
#   VERIFY_APP_RUNTIME_SERVICES — legacy override: comma-separated name:port:path (ignores JSON services[]; no DAG deps)
#   VERIFY_APP_RUNTIME_PARALLELISM — max concurrent service checks per wave (default: config defaults.parallelism or 8)
#   BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 — omit ollama-gateway / ollama-gateway-redis / ollama-worker from JSON-driven checks (must match bootstrap skip)
#   OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1 (default) — omit ollama-gateway-redis only (no in-cluster Endpoints)
#   VERIFY_APP_RUNTIME_SKIP_KAFKA_GATE=1 — skip verify-kafka-ready.sh (CI / clusters without in-cluster Kafka)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONFIG="${VERIFY_APP_RUNTIME_CONFIG:-$REPO_ROOT/infra/app_runtime_services.json}"
PROM_OUT="${VERIFY_APP_RUNTIME_PROM_OUT:-$REPO_ROOT/bench_logs/app_runtime_metrics.prom}"
HISTORY_OUT="${VERIFY_APP_RUNTIME_HISTORY:-$REPO_ROOT/bench_logs/app_runtime_history.jsonl}"

# cold | warm | unknown — used only for JSONL history / cold-vs-warm reports (not gating).
case "${VERIFY_APP_RUNTIME_PHASE:-}" in
  cold|warm) APP_RUNTIME_PHASE="${VERIFY_APP_RUNTIME_PHASE}" ;;
  *) APP_RUNTIME_PHASE="unknown" ;;
esac

command -v kubectl >/dev/null 2>&1 || {
  python3 -c "import json; print(json.dumps({'ok': False, 'errors': ['kubectl not on PATH']}))"
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  python3 -c "import json; print(json.dumps({'ok': False, 'errors': ['jq required (install jq)']}))"
  exit 1
}

[[ -f "$CONFIG" ]] || {
  python3 -c "import json,sys; print(json.dumps({'ok': False, 'errors': ['missing config: ' + sys.argv[1]]}))" "$CONFIG"
  exit 1
}

if [[ -z "${VERIFY_APP_RUNTIME_SERVICES:-}" ]]; then
  # Do not pass "$CONFIG" as a python3 argv — that runs the JSON file as a Python script (NameError on true/false).
  CONFIG_PATH="$CONFIG" python3 <<'PY'
import collections, json, os, sys

path = os.environ["CONFIG_PATH"]
with open(path, encoding="utf-8") as fh:
    cfg = json.load(fh)
services = cfg.get("services") or []
names = [str(s.get("name")) for s in services if s.get("name")]
ns = set(names)
for s in services:
    nm = str(s.get("name") or "")
    for d in s.get("depends_on") or []:
        ds = str(d)
        if ds not in ns:
            print(f"app_runtime_services.json: {nm} depends_on unknown service {ds!r}", file=sys.stderr)
            sys.exit(1)
deps = {str(s["name"]): [str(x) for x in (s.get("depends_on") or [])] for s in services if s.get("name")}
indeg = {n: 0 for n in names}
adj = {n: [] for n in names}
for n in names:
    for d in deps.get(n, []):
        if d not in ns:
            continue
        adj[d].append(n)
        indeg[n] += 1
q = collections.deque([n for n in names if indeg[n] == 0])
ind2 = dict(indeg)
seen = 0
while q:
    u = q.popleft()
    seen += 1
    for v in adj.get(u, []):
        ind2[v] -= 1
        if ind2[v] == 0:
            q.append(v)
if seen != len(names):
    print("app_runtime_services.json: depends_on cycle or unsatisfiable graph", file=sys.stderr)
    sys.exit(1)
PY
fi

NS_CFG="$(jq -r '.namespace // "off-campus-housing-tracker"' "$CONFIG")"
NS="${HOUSING_NS:-${NAMESPACE:-$NS_CFG}}"

if [[ "${VERIFY_APP_RUNTIME_SKIP_KAFKA_GATE:-0}" != "1" ]] && kubectl get sts kafka -n "$NS" --request-timeout=12s &>/dev/null; then
  echo "verify-app-runtime: Kafka readiness gate (verify-kafka-ready.sh)…" >&2
  chmod +x "$SCRIPT_DIR/verify-kafka-ready.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" bash "$SCRIPT_DIR/verify-kafka-ready.sh" \
    || {
      echo "verify-app-runtime: verify-kafka-ready failed — fix brokers or set VERIFY_APP_RUNTIME_SKIP_KAFKA_GATE=1" >&2
      exit 1
    }
elif [[ "${VERIFY_APP_RUNTIME_SKIP_KAFKA_GATE:-0}" == "1" ]]; then
  echo "verify-app-runtime: VERIFY_APP_RUNTIME_SKIP_KAFKA_GATE=1 — skipping verify-kafka-ready" >&2
fi

DEF_RETRIES="$(jq -r '.defaults.retries // 10' "$CONFIG")"
DEF_BO_INIT="$(jq -r '.defaults.backoff_initial_seconds // 2' "$CONFIG")"
DEF_BO_MAX="$(jq -r '.defaults.backoff_max_seconds // 60' "$CONFIG")"
DEF_ROLLOUT="$(jq -r '.defaults.rollout_timeout_seconds // 120' "$CONFIG")"
DEF_HC="$(jq -r '.defaults.health_connect_timeout_seconds // 3' "$CONFIG")"
DEF_HM="$(jq -r '.defaults.health_max_time_seconds // 12' "$CONFIG")"
DEF_PAR="$(jq -r '.defaults.parallelism // 8' "$CONFIG")"

if [[ "${VERIFY_APP_RUNTIME_MODE:-}" == "ci" ]]; then
  echo "  verify-app-runtime: VERIFY_APP_RUNTIME_MODE=ci (reduced retries/backoff/rollout/health timeouts)" >&2
  DEF_RETRIES=2
  DEF_BO_INIT=1
  DEF_BO_MAX=30
  DEF_ROLLOUT=60
  DEF_HC=2
  DEF_HM=8
  [[ -z "${VERIFY_APP_RUNTIME_PARALLELISM:-}" ]] && DEF_PAR=4
fi

PARALLEL_WAVE="${VERIFY_APP_RUNTIME_PARALLELISM:-$DEF_PAR}"
[[ "$PARALLEL_WAVE" =~ ^[0-9]+$ ]] || PARALLEL_WAVE=8
[[ "$PARALLEL_WAVE" -lt 1 ]] && PARALLEL_WAVE=1

emit_fail() {
  printf '%s\n' "$@" | NS="$NS" CONFIG="$CONFIG" PROM="$PROM_OUT" HIST="$HISTORY_OUT" PERC="${TMP_DIR:+$TMP_DIR/.percentiles.json}" MODE="${VERIFY_APP_RUNTIME_MODE:-normal}" PHASE="$APP_RUNTIME_PHASE" python3 -c "import json,sys,os; errs=[l.strip() for l in sys.stdin if l.strip()]; d={'ok':False,'namespace':os.environ['NS'],'config':os.environ['CONFIG'],'errors':errs}; p=os.environ.get('PROM','').strip();
if p: d['metrics']=p
h=os.environ.get('HIST','').strip()
if h: d['history']=h
d['verify_app_runtime_mode']=(os.environ.get('MODE') or 'normal').strip() or 'normal'
d['verify_app_runtime_phase']=(os.environ.get('PHASE') or 'unknown').strip() or 'unknown'
pc=os.environ.get('PERC','')
if pc and os.path.isfile(pc):
  with open(pc,encoding='utf-8') as fh: d['latency_percentiles_ms']=json.load(fh)
print(json.dumps(d))"
}

emit_ok() {
  NS="$NS" CONFIG="$CONFIG" PROM="$PROM_OUT" HIST="$HISTORY_OUT" PERC="${TMP_DIR:+$TMP_DIR/.percentiles.json}" MODE="${VERIFY_APP_RUNTIME_MODE:-normal}" PHASE="$APP_RUNTIME_PHASE" python3 -c "import json,os; d={'ok':True,'namespace':os.environ['NS'],'config':os.environ['CONFIG']}; p=os.environ.get('PROM','').strip();
if p: d['metrics']=p
h=os.environ.get('HIST','').strip()
if h: d['history']=h
d['verify_app_runtime_mode']=(os.environ.get('MODE') or 'normal').strip() or 'normal'
d['verify_app_runtime_phase']=(os.environ.get('PHASE') or 'unknown').strip() or 'unknown'
pc=os.environ.get('PERC','')
if pc and os.path.isfile(pc):
  with open(pc,encoding='utf-8') as fh: d['latency_percentiles_ms']=json.load(fh)
print(json.dumps(d))"
}

rollout_ok() {
  local name="$1" to="$2"
  kubectl -n "$NS" rollout status "deploy/$name" --timeout="${to}s" --request-timeout=30s >/dev/null 2>&1
}

_backoff_sleep() {
  local attempt="$1" init="$2" cap="$3"
  python3 -c "a,i,c=int('$attempt'),int('$init'),int('$cap'); print(min(c, i * (2 ** max(0, a - 1))))"
}

health_try() {
  local name="$1" url="$2" hc="$3" hm="$4"
  # api-gateway strict mode: loopback GET must send x-traffic-class: internal (see route-coverage-middleware).
  local gw_hdr=0
  [[ "$name" == "api-gateway" ]] && gw_hdr=1
  # Prefer curl/wget when present. For ollama, the upstream image may omit both; fall back to `ollama list`
  # (daemon RPC) so app-runtime verification does not depend on an HTTP client inside the workload pod.
  kubectl -n "$NS" exec "deploy/$name" -- env HURL="$url" HC="$hc" HM="$hm" NM="$name" GW_HDR="$gw_hdr" sh -ec \
    'if command -v curl >/dev/null 2>&1; then
       if [ "$GW_HDR" = "1" ]; then exec curl -sf --connect-timeout "$HC" --max-time "$HM" -H "x-traffic-class: internal" -o /dev/null "$HURL"; fi
       exec curl -sf --connect-timeout "$HC" --max-time "$HM" -o /dev/null "$HURL"
     fi
     if command -v wget >/dev/null 2>&1; then
       if [ "$GW_HDR" = "1" ]; then exec wget -q -O /dev/null --timeout="$HM" --header="x-traffic-class: internal" "$HURL"; fi
       exec wget -q -O /dev/null --timeout="$HM" "$HURL"
     fi
     if [ "$NM" = "ollama" ]; then exec ollama list >/dev/null 2>&1; fi
     exit 127' >/dev/null 2>&1
}

# In-pod grpc_health_probe with same TLS/mTLS flags as infra/k8s base Deployments (strict backends).
grpc_health_try() {
  local name="$1" bin="$2" grpc_port="$3" grpc_svc="$4" hc="$5" hm="$6" tls_on="$7"
  if [[ "$tls_on" == "1" ]]; then
    kubectl -n "$NS" exec "deploy/$name" -- \
      "$bin" \
      -addr="localhost:${grpc_port}" \
      -service="$grpc_svc" \
      -tls -tls-no-verify=false \
      -tls-ca-cert=/etc/certs/ca.crt \
      -tls-client-cert=/etc/certs/tls.crt \
      -tls-client-key=/etc/certs/tls.key \
      -tls-server-name=localhost \
      -connect-timeout="${hc}s" \
      -rpc-timeout="${hm}s" >/dev/null 2>&1
  else
    kubectl -n "$NS" exec "deploy/$name" -- \
      "$bin" \
      -addr="localhost:${grpc_port}" \
      -service="$grpc_svc" \
      -connect-timeout="${hc}s" \
      -rpc-timeout="${hm}s" >/dev/null 2>&1
  fi
}

# Run rollout + health loop; write one JSON line to result_path: {name, ok, latency_ms, error, protocol?}
_check_service_worker() {
  local svcjson="$1" result_path="$2"
  local name port path health_type grpc_port grpc_service grpc_tls probe_bin
  local retries bo_init bo_max rollout_t hc hm url
  local t0 t1 latency_ms err="" ok=0 success_protocol=""

  name="$(jq -r '.name' <<<"$svcjson")"
  health_type="$(jq -r '.health_type // "http"' <<<"$svcjson")"
  port="$(jq -r '.port // empty' <<<"$svcjson")"
  path="$(jq -r '.health_path // "/healthz"' <<<"$svcjson")"
  grpc_port="$(jq -r '.grpc_port // empty' <<<"$svcjson")"
  grpc_service="$(jq -r '.grpc_service // empty' <<<"$svcjson")"
  grpc_tls="$(jq -r 'if .grpc_tls == false then 0 else 1 end' <<<"$svcjson")"
  probe_bin="$(jq -r '.grpc_probe_binary // "/usr/local/bin/grpc-health-probe"' <<<"$svcjson")"
  retries="$(jq -r ".retries // $DEF_RETRIES" <<<"$svcjson")"
  bo_init="$(jq -r ".backoff_initial_seconds // $DEF_BO_INIT" <<<"$svcjson")"
  bo_max="$(jq -r ".backoff_max_seconds // $DEF_BO_MAX" <<<"$svcjson")"
  rollout_t="$(jq -r ".rollout_timeout_seconds // $DEF_ROLLOUT" <<<"$svcjson")"
  hc="$(jq -r ".health_connect_timeout_seconds // $DEF_HC" <<<"$svcjson")"
  hm="$(jq -r ".health_max_time_seconds // $DEF_HM" <<<"$svcjson")"

  if [[ "$health_type" != "http" && "$health_type" != "grpc" && "$health_type" != "auto" ]]; then
    err="deployment/${name}: invalid health_type '${health_type}' (use http, grpc, or auto)"
  elif [[ "$health_type" == "grpc" ]]; then
    if [[ -z "$grpc_port" || -z "$grpc_service" ]]; then
      err="deployment/${name}: health_type=grpc requires grpc_port and grpc_service"
    fi
  elif [[ "$health_type" == "auto" ]]; then
    if [[ -z "$port" || -z "$grpc_port" || -z "$grpc_service" ]]; then
      err="deployment/${name}: health_type=auto requires port, health_path, grpc_port, and grpc_service"
    fi
  else
    if [[ -z "$port" ]]; then
      err="deployment/${name}: health_type=http requires port"
    fi
  fi

  # In-pod loopback is correct for most services. Ollama is special: hit the Service DNS from inside the pod
  # (same pattern as analytics → ollama) so we never rely on localhost-only assumptions across images.
  if [[ "$name" == "ollama" ]]; then
    url="http://ollama.${NS}.svc.cluster.local:${port}${path}"
  else
    url="http://127.0.0.1:${port}${path}"
  fi

  t0="$(python3 -c "import time; print(int(time.time()*1000))")"

  if [[ -n "$err" ]]; then
    :
  elif ! rollout_ok "$name" "$rollout_t"; then
    err="deployment/${name}: rollout not complete within ${rollout_t}s"
  else
    local i=1
    while [[ "$i" -le "$retries" ]]; do
      local http_ok=0 grpc_ok=0
      if [[ "$health_type" == "http" || "$health_type" == "auto" ]]; then
        if health_try "$name" "$url" "$hc" "$hm"; then
          http_ok=1
        fi
      fi
      if [[ "$health_type" == "grpc" ]]; then
        if grpc_health_try "$name" "$probe_bin" "$grpc_port" "$grpc_service" "$hc" "$hm" "$grpc_tls"; then
          grpc_ok=1
        fi
      elif [[ "$health_type" == "auto" ]]; then
        if [[ "$http_ok" -ne 1 ]] && grpc_health_try "$name" "$probe_bin" "$grpc_port" "$grpc_service" "$hc" "$hm" "$grpc_tls"; then
          grpc_ok=1
        fi
      fi

      if [[ "$health_type" == "http" && "$http_ok" -eq 1 ]]; then
        echo "  ✅ ${name} ready (HTTP, ${i}/${retries})" >&2
        ok=1
        success_protocol="http"
        break
      fi
      if [[ "$health_type" == "grpc" && "$grpc_ok" -eq 1 ]]; then
        echo "  ✅ ${name} ready (gRPC, ${i}/${retries})" >&2
        ok=1
        success_protocol="grpc"
        break
      fi
      if [[ "$health_type" == "auto" && ( "$http_ok" -eq 1 || "$grpc_ok" -eq 1 ) ]]; then
        if [[ "$http_ok" -eq 1 ]]; then
          echo "  ✅ ${name} ready (HTTP, ${i}/${retries})" >&2
          success_protocol="http"
        else
          echo "  ✅ ${name} ready (gRPC, ${i}/${retries})" >&2
          success_protocol="grpc"
        fi
        ok=1
        break
      fi

      if [[ "$i" -ge "$retries" ]]; then
        break
      fi
      local sleep_sec
      sleep_sec="$(_backoff_sleep "$i" "$bo_init" "$bo_max")"
      echo "  ⏳ ${name} health attempt ${i}/${retries} failed (${health_type}) → sleep ${sleep_sec}s (backoff)" >&2
      sleep "$sleep_sec"
      i=$((i + 1))
    done
    if [[ "$ok" -ne 1 ]]; then
      case "$health_type" in
        http)
          err="deployment/${name}: GET ${url} not OK after ${retries} attempts (backoff ${bo_init}s..${bo_max}s cap)"
          ;;
        grpc)
          err="deployment/${name}: gRPC Health/Check (${grpc_service} @ localhost:${grpc_port}) not OK after ${retries} attempts (grpc_health_probe in pod; backoff ${bo_init}s..${bo_max}s cap)"
          ;;
        auto)
          err="deployment/${name}: neither GET ${url} nor gRPC (${grpc_service} @ localhost:${grpc_port}) OK after ${retries} attempts (backoff ${bo_init}s..${bo_max}s cap)"
          ;;
      esac
    fi
  fi

  t1="$(python3 -c "import time; print(int(time.time()*1000))")"
  latency_ms=$((t1 - t0))

  NAME="$name" OK="$ok" LAT="$latency_ms" ERR="$err" PROTO="$success_protocol" OUT="$result_path" python3 -c "import json,os
p=os.environ.get('PROTO','').strip()
d={'name':os.environ['NAME'],'ok':int(os.environ['OK']),'latency_ms':int(os.environ['LAT']),'error':os.environ.get('ERR','')}
if p: d['protocol']=p
json.dump(d, open(os.environ['OUT'],'w'), separators=(',',':'))"
}

svc_json_from_legacy_line() {
  local line="$1" name port path
  [[ -z "${line// }" ]] && return 1
  IFS=':' read -r name port path <<< "$line"
  [[ -z "${name:-}" || -z "${port:-}" ]] && return 1
  path="${path:-/healthz}"
  jq -n \
    --arg name "$name" \
    --argjson port "$port" \
    --arg path "$path" \
    --argjson r "$DEF_RETRIES" \
    --argjson bi "$DEF_BO_INIT" \
    --argjson bm "$DEF_BO_MAX" \
    --argjson rt "$DEF_ROLLOUT" \
    --argjson hc "$DEF_HC" \
    --argjson hm "$DEF_HM" \
    '{name:$name,port:$port,health_path:$path,depends_on:[],retries:r,backoff_initial_seconds:bi,backoff_max_seconds:bm,rollout_timeout_seconds:rt,health_connect_timeout_seconds:hc,health_max_time_seconds:hm}'
}

_write_prom_file() {
  local tmp_dir="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  METRIC_TMP_DIR="$tmp_dir" OUT="$out" NS="$NS" MODE="${VERIFY_APP_RUNTIME_MODE:-normal}" PHASE="$APP_RUNTIME_PHASE" \
    APP_RUNTIME_CFG="${APP_RUNTIME_CFG:-}" APP_RUNTIME_LEGACY_SERVICES="${APP_RUNTIME_LEGACY_SERVICES:-0}" python3 <<'PY'
import collections, glob, json, math, os

def esc_label(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

def nearest_rank_ms(sorted_ms, p):
    """p in [0,100]; nearest-rank on sorted integer milliseconds (p100 == max)."""
    n = len(sorted_ms)
    if n == 0:
        return 0
    k = max(1, min(n, math.ceil(p / 100.0 * n)))
    return int(sorted_ms[k - 1])

# Prometheus histogram buckets (seconds); +Inf appended in exposition.
BUCKETS_SEC = (0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0)

def fmt_float(x):
    s = format(float(x), ".6f").rstrip("0").rstrip(".")
    return s if s else "0"

def histogram_triplet_lines(metric, label_inner, value_sec):
    """One observation; _bucket values are cumulative counts in (-inf, le]."""
    lines = []
    for b in BUCKETS_SEC:
        le = fmt_float(b)
        cum = 1 if value_sec <= b + 1e-12 else 0
        lines.append(f'{metric}_bucket{{{label_inner},le="{le}"}} {cum}')
    lines.append(f'{metric}_bucket{{{label_inner},le="+Inf"}} 1')
    lines.append(f'{metric}_sum{{{label_inner}}} {fmt_float(value_sec)}')
    lines.append(f'{metric}_count{{{label_inner}}} 1')
    return lines

out = os.environ["OUT"]
ns = esc_label(os.environ["NS"])
mode = esc_label((os.environ.get("MODE") or "normal").strip() or "normal")
phase = esc_label((os.environ.get("PHASE") or "unknown").strip() or "unknown")
tmpdir = os.environ["METRIC_TMP_DIR"]
lines = [
    "# HELP app_runtime_ready Service passed rollout + configured readiness probe (1=ok, 0=fail).",
    "# TYPE app_runtime_ready gauge",
    "# HELP app_runtime_latency_ms Wall time in ms for rollout+health attempts for this service (this run).",
    "# TYPE app_runtime_latency_ms gauge",
    "# HELP app_runtime_health_used_protocol 1 when the successful check used this protocol (http or grpc; this run).",
    "# TYPE app_runtime_health_used_protocol gauge",
    "# HELP app_runtime_service_latency_seconds Per-service wall time to readiness (this run); native histogram exposition.",
    "# TYPE app_runtime_service_latency_seconds histogram",
    "# HELP app_runtime_critical_path_ms Longest depends_on chain: sum of per-service verifier wall times (ms) along that chain (this run).",
    "# TYPE app_runtime_critical_path_ms gauge",
    "# HELP app_runtime_service_critical_path_ms Same chain sum ending at this service (ms; this run).",
    "# TYPE app_runtime_service_critical_path_ms gauge",
    "# HELP app_runtime_dependency_latency_ms Labeled dependency edge; value = wall ms for the dependent service (this run).",
    "# TYPE app_runtime_dependency_latency_ms gauge",
]
latencies = []
rows = []
for path in sorted(glob.glob(os.path.join(tmpdir, "*.json"))):
    if os.path.basename(path).startswith("."):
        continue
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    name = esc_label(str(d["name"]))
    ready = int(d["ok"])
    lat = int(d["latency_ms"])
    latencies.append(lat)
    rows.append((name, ready, lat))
    lines.append(f'app_runtime_ready{{service="{name}",namespace="{ns}"}} {ready}')
    lines.append(f'app_runtime_latency_ms{{service="{name}",namespace="{ns}"}} {lat}')
    prot = str(d.get("protocol") or "").strip().lower()
    if ready == 1 and prot in ("http", "grpc"):
        lines.append(
            f'app_runtime_health_used_protocol{{service="{name}",namespace="{ns}",protocol="{prot}",mode="{mode}",phase="{phase}"}} 1'
        )
    sec = lat / 1000.0
    inner = f'service="{name}",namespace="{ns}",mode="{mode}",phase="{phase}"'
    lines.extend(histogram_triplet_lines("app_runtime_service_latency_seconds", inner, sec))

latencies.sort()
p50 = nearest_rank_ms(latencies, 50)
p95 = nearest_rank_ms(latencies, 95)
p99 = nearest_rank_ms(latencies, 99)
p100 = latencies[-1] if latencies else 0
pct_payload = {"p50": p50, "p95": p95, "p99": p99, "p100": p100}
with open(os.path.join(tmpdir, ".percentiles.json"), "w", encoding="utf-8") as fh:
    json.dump(pct_payload, fh, separators=(",", ":"))

lines.extend(
    [
        "# HELP app_runtime_latency_percentile_ms Nearest-rank percentile of per-service wall times (ms) in this run (all services).",
        "# TYPE app_runtime_latency_percentile_ms gauge",
        f'app_runtime_latency_percentile_ms{{quantile="0.50",namespace="{ns}",mode="{mode}"}} {p50}',
        f'app_runtime_latency_percentile_ms{{quantile="0.95",namespace="{ns}",mode="{mode}"}} {p95}',
        f'app_runtime_latency_percentile_ms{{quantile="0.99",namespace="{ns}",mode="{mode}"}} {p99}',
        f'app_runtime_latency_percentile_ms{{quantile="1.00",namespace="{ns}",mode="{mode}"}} {p100}',
    ]
)

# Run-level pooled histogram (one observation per service; buckets = count of services <= le).
lines.append(
    "# HELP app_runtime_run_latency_distribution_seconds Pooled per-service latencies this run (count = services)."
)
lines.append("# TYPE app_runtime_run_latency_distribution_seconds histogram")
lat_sec = [x / 1000.0 for x in latencies]
run_inner = f'namespace="{ns}",mode="{mode}",phase="{phase}"'
if lat_sec:
    prev_c = 0
    for b in BUCKETS_SEC:
        le = fmt_float(b)
        c = sum(1 for v in lat_sec if v <= b + 1e-12)
        lines.append(f'app_runtime_run_latency_distribution_seconds_bucket{{{run_inner},le="{le}"}} {c}')
    lines.append(f'app_runtime_run_latency_distribution_seconds_bucket{{{run_inner},le="+Inf"}} {len(lat_sec)}')
    lines.append(f'app_runtime_run_latency_distribution_seconds_sum{{{run_inner}}} {fmt_float(sum(lat_sec))}')
    lines.append(f'app_runtime_run_latency_distribution_seconds_count{{{run_inner}}} {len(lat_sec)}')
else:
    for b in BUCKETS_SEC:
        le = fmt_float(b)
        lines.append(f'app_runtime_run_latency_distribution_seconds_bucket{{{run_inner},le="{le}"}} 0')
    lines.append(f'app_runtime_run_latency_distribution_seconds_bucket{{{run_inner},le="+Inf"}} 0')
    lines.append(f'app_runtime_run_latency_distribution_seconds_sum{{{run_inner}}} 0')
    lines.append(f'app_runtime_run_latency_distribution_seconds_count{{{run_inner}}} 0')

cfg_path = (os.environ.get("APP_RUNTIME_CFG") or "").strip()
legacy = (os.environ.get("APP_RUNTIME_LEGACY_SERVICES") or "").strip() == "1"
dag_payload = {}
if cfg_path and os.path.isfile(cfg_path) and not legacy:
    with open(cfg_path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    services = cfg.get("services") or []
    nodes = [str(s["name"]) for s in services if s.get("name")]
    node_set = set(nodes)
    deps = {
        str(s["name"]): [str(x) for x in (s.get("depends_on") or []) if str(x) in node_set]
        for s in services
        if s.get("name")
    }
    dur = {}
    for n in nodes:
        rp = os.path.join(tmpdir, f"{n}.json")
        if os.path.isfile(rp):
            with open(rp, encoding="utf-8") as fh2:
                dd = json.load(fh2)
            dur[n] = int(dd.get("latency_ms", 0))
        else:
            dur[n] = 0
    indeg = {n: 0 for n in nodes}
    adj = {n: [] for n in nodes}
    for n in nodes:
        for d in deps.get(n, []):
            if d not in node_set:
                continue
            adj[d].append(n)
            indeg[n] += 1
    q = collections.deque([n for n in nodes if indeg[n] == 0])
    order = []
    ind2 = dict(indeg)
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj.get(u, []):
            ind2[v] -= 1
            if ind2[v] == 0:
                q.append(v)
    cp = {n: 0 for n in nodes}
    if len(order) == len(nodes):
        for u in order:
            pred = deps.get(u, [])
            mx = max((cp[d] for d in pred), default=0)
            cp[u] = dur.get(u, 0) + mx
    dag_max = max(cp.values()) if cp else 0
    lines.append(f'app_runtime_critical_path_ms{{namespace="{ns}",mode="{mode}",phase="{phase}"}} {dag_max}')
    for n in nodes:
        cpn = esc_label(n)
        lines.append(
            f'app_runtime_service_critical_path_ms{{service="{cpn}",namespace="{ns}",mode="{mode}",phase="{phase}"}} {cp.get(n, 0)}'
        )
    for n in nodes:
        for d in deps.get(n, []):
            dn = esc_label(d)
            nn = esc_label(n)
            lines.append(
                f'app_runtime_dependency_latency_ms{{from="{dn}",to="{nn}",namespace="{ns}",mode="{mode}",phase="{phase}"}} {dur.get(n, 0)}'
            )
    dag_payload = {"critical_path_ms": dag_max, "service_critical_path_ms": cp, "namespace": ns}

dag_path = os.path.join(tmpdir, ".dag_analysis.json")
if dag_payload:
    with open(dag_path, "w", encoding="utf-8") as fh:
        json.dump(dag_payload, fh, separators=(",", ":"))

tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
os.replace(tmp, out)
PY
}

_append_app_runtime_history() {
  local ok_flag="$1"
  [[ "${VERIFY_APP_RUNTIME_SKIP_HISTORY:-0}" == "1" ]] && return 0
  OK_FLAG="$ok_flag" TMP_DIR="$TMP_DIR" NS="$NS" MODE="${VERIFY_APP_RUNTIME_MODE:-normal}" PHASE="$APP_RUNTIME_PHASE" PROM="$PROM_OUT" HIST="$HISTORY_OUT" python3 <<'PY'
import glob, json, os, time

def main():
    if os.environ.get("OK_FLAG", "0") not in ("0", "1"):
        return
    tmp = os.environ.get("TMP_DIR", "")
    hist_path = os.environ.get("HIST", "").strip()
    if not hist_path or not tmp or not os.path.isdir(tmp):
        return
    ok = os.environ["OK_FLAG"] == "1"
    ns = os.environ.get("NS", "")
    mode = (os.environ.get("MODE") or "normal").strip() or "normal"
    phase = (os.environ.get("PHASE") or "unknown").strip() or "unknown"
    prom = os.environ.get("PROM", "").strip()
    err_path = os.path.join(tmp, ".history_errors.txt")
    errors = []
    if os.path.isfile(err_path):
        with open(err_path, encoding="utf-8") as fh:
            errors = [ln.strip() for ln in fh if ln.strip()]
    services = []
    for path in sorted(glob.glob(os.path.join(tmp, "*.json"))):
        if os.path.basename(path).startswith("."):
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        row = {
            "name": d.get("name"),
            "ok": int(d.get("ok", 0)) == 1,
            "latency_ms": int(d.get("latency_ms", 0)),
        }
        hp = (d.get("protocol") or "").strip()
        if hp:
            row["health_protocol"] = hp
        services.append(row)
    pct_path = os.path.join(tmp, ".percentiles.json")
    percentiles = {}
    if os.path.isfile(pct_path):
        with open(pct_path, encoding="utf-8") as fh:
            percentiles = json.load(fh)
    ms = int(time.time() * 1000)
    rec = {
        "unix_ms": ms,
        "namespace": ns,
        "verify_app_runtime_mode": mode,
        "verify_app_runtime_phase": phase,
        "ok": ok,
        "metrics": prom,
        "services": services,
        "percentiles_ms": percentiles,
        "errors": errors,
    }
    dag_path = os.path.join(tmp, ".dag_analysis.json")
    if os.path.isfile(dag_path):
        with open(dag_path, encoding="utf-8") as fh:
            rec["dag_analysis"] = json.load(fh)
    os.makedirs(os.path.dirname(hist_path) or ".", exist_ok=True)
    with open(hist_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, separators=(",", ":")) + "\n")

main()
PY
}

_collect_service_jsons() {
  if [[ -n "${VERIFY_APP_RUNTIME_SERVICES:-}" ]]; then
    _parts=()
    IFS=',' read -r -a _parts <<< "${VERIFY_APP_RUNTIME_SERVICES// /}"
    for _s in "${_parts[@]}"; do
      [[ -z "$_s" ]] && continue
      j="$(svc_json_from_legacy_line "$_s" || true)"
      [[ -z "${j:-}" ]] && continue
      printf '%s\n' "$j"
    done
  else
    if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" == "1" ]]; then
      jq -c '.services[] | select(
        .name != "ollama-gateway" and .name != "ollama-gateway-redis" and .name != "ollama-worker"
      )' "$CONFIG"
    elif [[ "${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}" == "1" ]]; then
      jq -c '.services[] | select(.name != "ollama-gateway-redis")' "$CONFIG"
    else
      jq -c '.services[]' "$CONFIG"
    fi
  fi
}

_get_svc_json_by_name() {
  local nm="$1"
  if [[ -n "${VERIFY_APP_RUNTIME_SERVICES:-}" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      [[ "$(jq -r '.name' <<<"$line")" == "$nm" ]] || continue
      printf '%s\n' "$line"
      return 0
    done < <(_collect_service_jsons)
    return 1
  fi
  jq -c --arg n "$nm" '.services[] | select(.name==$n)' "$CONFIG"
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/done"

APP_RUNTIME_CFG="$CONFIG"
if [[ -n "${VERIFY_APP_RUNTIME_SERVICES:-}" ]]; then
  APP_RUNTIME_LEGACY_SERVICES=1
else
  APP_RUNTIME_LEGACY_SERVICES=0
fi
export APP_RUNTIME_CFG APP_RUNTIME_LEGACY_SERVICES

echo "  verify-app-runtime: DAG waves (depends_on), parallelism=${PARALLEL_WAVE}" >&2

_wave_errors=()
while true; do
  ready=()
  while IFS= read -r svcjson; do
    [[ -z "${svcjson}" ]] && continue
    sname="$(jq -r '.name' <<<"$svcjson")"
    [[ -f "$TMP_DIR/done/$sname" ]] && continue
    deps_ok=1
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      [[ -f "$TMP_DIR/done/$dep" ]] || deps_ok=0
    done < <(jq -r '.depends_on[]? // empty' <<<"$svcjson")
    [[ "$deps_ok" -eq 1 ]] && ready+=("$sname")
  done < <(_collect_service_jsons)

  if [[ "${#ready[@]}" -eq 0 ]]; then
    pending=0
    while IFS= read -r svcjson; do
      [[ -z "${svcjson}" ]] && continue
      sname="$(jq -r '.name' <<<"$svcjson")"
      [[ -f "$TMP_DIR/done/$sname" ]] || pending=$((pending + 1))
    done < <(_collect_service_jsons)
    if [[ "$pending" -eq 0 ]]; then
      break
    fi
    echo "  ❌ verify-app-runtime: dependency deadlock (remaining=${pending}; check depends_on / failures above)" >&2
    _wave_errors+=("dependency graph: no runnable service but ${pending} incomplete (failed dependency or cycle)")
    break
  fi

  ready_sorted=()
  while IFS= read -r x; do
    [[ -n "$x" ]] && ready_sorted+=("$x")
  done < <(printf '%s\n' "${ready[@]}" | sort -u)

  idx=0
  n_ready=${#ready_sorted[@]}
  while [[ "$idx" -lt "$n_ready" ]]; do
    chunk_pids=()
    chunk_names=()
    c=0
    while [[ "$c" -lt "$PARALLEL_WAVE" && "$idx" -lt "$n_ready" ]]; do
      chunk_names+=("${ready_sorted[idx]}")
      idx=$((idx + 1))
      c=$((c + 1))
    done
    for nm in "${chunk_names[@]}"; do
      svcjson="$(_get_svc_json_by_name "$nm")" || svcjson=""
      [[ -n "$svcjson" ]] || {
        _wave_errors+=("deployment/${nm}: missing service definition")
        continue
      }
      resf="$TMP_DIR/${nm}.json"
      _check_service_worker "$svcjson" "$resf" &
      chunk_pids+=("$!")
    done
    for pid in "${chunk_pids[@]}"; do
      wait "$pid" || true
    done
    for nm in "${chunk_names[@]}"; do
      resf="$TMP_DIR/${nm}.json"
      if [[ ! -f "$resf" ]]; then
        _wave_errors+=("deployment/${nm}: internal verifier error (missing result file)")
        continue
      fi
      if [[ "$(jq -r '.ok' "$resf")" == "1" ]]; then
        touch "$TMP_DIR/done/$nm"
      else
        errline="$(jq -r '.error // empty' "$resf")"
        [[ -n "$errline" ]] && _wave_errors+=("$errline")
      fi
    done
  done

  if [[ "${#_wave_errors[@]}" -gt 0 ]]; then
    break
  fi
done

_write_prom_file "$TMP_DIR" "$PROM_OUT"

errors=("${_wave_errors[@]}")
if [[ "${#errors[@]}" -eq 0 ]]; then
  while IFS= read -r svcjson; do
    [[ -z "${svcjson}" ]] && continue
    sname="$(jq -r '.name' <<<"$svcjson")"
    resf="$TMP_DIR/${sname}.json"
    if [[ ! -f "$resf" ]]; then
      errors+=("deployment/${sname}: internal verifier error (missing result file)")
      continue
    fi
    if [[ "$(jq -r '.ok' "$resf")" != "1" ]]; then
      errline="$(jq -r '.error // empty' "$resf")"
      [[ -n "$errline" ]] && errors+=("$errline")
    fi
  done < <(_collect_service_jsons)
fi

if [[ "${#errors[@]}" -gt 0 ]]; then
  : >"$TMP_DIR/.history_errors.txt"
  printf '%s\n' "${errors[@]}" >"$TMP_DIR/.history_errors.txt"
  _append_app_runtime_history 0
  emit_fail "${errors[@]}"
  exit 1
fi

if [[ "${VERIFY_APP_RUNTIME_SKIP_ANALYTICS_OLLAMA:-0}" != "1" ]] && [[ -z "${VERIFY_APP_RUNTIME_SERVICES:-}" ]]; then
  if jq -e '.services[]? | select(.name == "analytics-service")' "$CONFIG" >/dev/null 2>&1; then
    if kubectl get deploy/analytics-service -n "$NS" --request-timeout=15s &>/dev/null; then
      echo "  verify-app-runtime: analytics-service → ollama reachability (in-cluster)" >&2
      if ! kubectl exec -n "$NS" deploy/analytics-service -- node -e "
        const u = 'http://ollama:11434/api/tags';
        fetch(u, { signal: AbortSignal.timeout(8000) })
          .then((r) => { if (!r.ok) { process.stderr.write('HTTP '+r.status); process.exit(1); } process.exit(0); })
          .catch((e) => { process.stderr.write(String(e && e.message ? e.message : e)); process.exit(1); });
      " 2>/dev/null; then
        emit_fail "deployment/analytics-service: cannot reach ollama at http://ollama:11434 (timeout/ECONNREFUSED/DNS — check ollama Service and networkPolicy)"
        exit 1
      fi
    fi
  fi
fi

: >"$TMP_DIR/.history_errors.txt"
_append_app_runtime_history 1
emit_ok
exit 0
