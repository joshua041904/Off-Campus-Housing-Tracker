#!/usr/bin/env bash
# Sourced by k6 orchestration scripts (not executed directly).
# Cooldown + cluster visibility after each k6 block to reduce cross-test contention (Colima/k3s).
# Optionally append all snapshots to K6_SUITE_RESOURCE_LOG (see preflight + docs/perf/CLUSTER_CONTENTION_WATCH.md).
#
# Env (all optional):
#   K6_SUITE_COOLDOWN_SEC=15           — sleep after every k6 block
#   K6_SUITE_CAR_EXTRA_SEC=20          — extra sleep after constant-arrival-rate tests (after cooldown)
#   K6_SUITE_LOG_TOP=1                 — print kubectl top nodes + pods after each block
#   K6_SUITE_RESOURCE_LOG=           — if set, append the same snapshot text to this file (prove contention offline)
#   K6_SUITE_LOG_TOP_BEFORE=0        — if 1, k6_suite_before_k6_block logs "before-*" snapshot too
#   K6_SUITE_WARN_HOT_RESOURCES=1    — warn when node CPU% or MEM% ≥ K6_SUITE_WARN_NODE_CPU / _MEM (default 80)
#   K6_SUITE_FAIL_ON_NODE_CPU=1      — exit 3 if any node CPU% >= K6_SUITE_NODE_CPU_MAX (default 85)
#   K6_SUITE_NODE_CPU_MAX=85
#   K6_SUITE_TOP_NS=off-campus-housing-tracker
#   K6_SUITE_TOP_ENVOY_NS=envoy-test — empty to skip envoy namespace
#   K6_SUITE_RESTART_ENVOY_AFTER_CAR=0 — if 1, after CAR tests: rollout restart envoy-test + sleep
#   K6_SUITE_COLIMA_DROP_CACHES=0    — if 1, before each k6 block: colima ssh drop_caches (lab only; harsh)
#   K6_SUITE_GATEWAY_DRAIN=0         — if 1, after k6: wait until api-gateway pod CPU (max) < K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES (needs metrics-server)
#   K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES=150
#   K6_SUITE_GATEWAY_DRAIN_INTERVAL_SEC=2
#   K6_SUITE_GATEWAY_DRAIN_TIMEOUT_SEC=120
#   K6_SUITE_GATEWAY_DRAIN_NAME_SUBSTR=api-gateway  — match pod name (substring)
#   K6_SUITE_POST_DRAIN_SLEEP_SEC=0  — extra sleep after drain succeeds (e.g. 10 for harsh lab)
#   K6_SUITE_KILL_K6_AFTER_BLOCK=0   — if 1, SIGKILL any lingering `k6` process (lab only; kills all k6 on host)

k6_suite_append_log() {
  local logf="${K6_SUITE_RESOURCE_LOG:-}"
  [[ -n "$logf" ]] || return 0
  mkdir -p "$(dirname "$logf")" 2>/dev/null || true
  cat >>"$logf"
}

# Warn if any node reports high CPU% or MEMORY% (kubectl top nodes).
k6_suite_warn_hot_resources() {
  [[ "${K6_SUITE_WARN_HOT_RESOURCES:-1}" != "1" ]] && return 0
  local cpu_w="${K6_SUITE_WARN_NODE_CPU:-80}"
  local mem_w="${K6_SUITE_WARN_NODE_MEM:-80}"
  local top_out
  top_out=$(kubectl top nodes --no-headers 2>/dev/null) || return 0
  [[ -z "$top_out" ]] && return 0
  echo "$top_out" | awk -v cw="$cpu_w" -v mw="$mem_w" '
    {
      gsub(/%/,"",$3)
      gsub(/%/,"",$5)
      c = $3 + 0
      m = $5 + 0
      if (c >= cw) print "⚠️  k6 suite: node " $1 " CPU%=" c " (watch threshold " cw "%)"
      if (m >= mw) print "⚠️  k6 suite: node " $1 " MEM%=" m " (watch threshold " mw "%)"
    }
  '
}

# Snapshot: pods using ≥ ~1000m CPU (≈1 core) — single-sample hint only.
k6_suite_warn_heavy_pods() {
  [[ "${K6_SUITE_WARN_HEAVY_PODS:-1}" != "1" ]] && return 0
  local ns="${K6_SUITE_TOP_NS:-off-campus-housing-tracker}"
  kubectl top pods -n "$ns" --no-headers 2>/dev/null | awk '$2 ~ /^[0-9]+m$/ {
    gsub(/m/,"",$2)
    if ($2+0 >= 1000) print "⚠️  k6 suite: pod " $1 " CPU=" $2 "m (≥~1 core this sample)"
  }' >&2 || true
}

# Optional: snapshot + harsh VM page cache drop (Colima only). Use only in a dedicated lab.
k6_suite_maybe_drop_caches() {
  [[ "${K6_SUITE_COLIMA_DROP_CACHES:-0}" == "1" ]] || return 0
  if ! command -v colima >/dev/null 2>&1; then
    echo "⚠️  K6_SUITE_COLIMA_DROP_CACHES=1 but colima not on PATH"
    return 0
  fi
  if ! colima status 2>/dev/null | grep -qi running; then
    echo "⚠️  K6_SUITE_COLIMA_DROP_CACHES=1 but Colima not running"
    return 0
  fi
  echo "  k6 suite: Colima VM drop_caches (K6_SUITE_COLIMA_DROP_CACHES=1 — lab only)"
  colima ssh -- sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null || echo "⚠️  drop_caches failed (needs sudo in VM)"
}

# Call immediately before each k6 run (drop_caches + optional pre-snapshot).
k6_suite_before_k6_block() {
  local label="${1:-k6}"
  k6_suite_maybe_drop_caches
  if [[ "${K6_SUITE_LOG_TOP_BEFORE:-0}" == "1" ]]; then
    k6_suite_log_top "before-${label}"
  fi
  return 0
}

k6_suite_log_top() {
  local label="${1:-post-k6}"
  [[ "${K6_SUITE_LOG_TOP:-1}" != "1" ]] && return 0
  local out
  out=$(
    echo ""
    echo "━━ k6 suite resource snapshot: $label ($(date -Iseconds)) ━━"
    kubectl top nodes 2>/dev/null || echo "  (kubectl top nodes unavailable — metrics-server?)"
    _ns="${K6_SUITE_TOP_NS:-off-campus-housing-tracker}"
    echo "--- kubectl top pods -n ${_ns} (top 60) ---"
    kubectl top pods -n "$_ns" --no-headers 2>/dev/null | head -60 || echo "  (kubectl top pods -n ${_ns} unavailable)"
    _ens="${K6_SUITE_TOP_ENVOY_NS:-envoy-test}"
    if [[ -n "$_ens" ]]; then
      echo "--- kubectl top pods -n ${_ens} ---"
      kubectl top pods -n "$_ens" --no-headers 2>/dev/null | head -30 || true
    fi
  )
  echo "$out"
  echo "$out" | k6_suite_append_log
  # stderr-style warnings so they appear in console and tee'd preflight log
  k6_suite_warn_hot_resources >&2
  k6_suite_warn_heavy_pods
  # Optional: call out Postgres-shaped workloads (name contains postgres)
  kubectl top pods -n "${K6_SUITE_TOP_NS:-off-campus-housing-tracker}" --no-headers 2>/dev/null | awk 'tolower($1) ~ /postgres/ && $2 ~ /m$/ {
    gsub(/m/,"",$2)
    if ($2+0 >= 200) print "ℹ️  k6 suite: Postgres-related pod " $1 " CPU=" $2 "m (watch for DB spike)"
  }' >&2 || true
}

# Returns 0 if OK or check skipped; 3 if CPU over threshold (caller should fail suite).
k6_suite_check_node_cpu() {
  local label="${1:-}"
  [[ "${K6_SUITE_FAIL_ON_NODE_CPU:-1}" != "1" ]] && return 0
  local max_allowed="${K6_SUITE_NODE_CPU_MAX:-85}"
  local top_out
  top_out=$(kubectl top nodes --no-headers 2>/dev/null) || {
    echo "⚠️  k6 suite ($label): skip node CPU check (kubectl top nodes failed — metrics-server?)" >&2
    return 0
  }
  [[ -z "$top_out" ]] && return 0
  local peak
  peak=$(echo "$top_out" | awk '
    {
      gsub(/%/,"",$3)
      if ($3 ~ /^[0-9]+(\.[0-9]+)?$/) {
        v = $3 + 0
        if (v > m) m = v
      }
    }
    END { if (m == "") print "-1"; else printf "%.0f", m }
  ')
  if [[ "$peak" == "-1" ]] || [[ -z "$peak" ]]; then
    echo "⚠️  k6 suite ($label): could not parse node CPU%% from kubectl top — not failing" >&2
    return 0
  fi
  echo "  k6 suite: peak node CPU%=${peak}% (threshold ${max_allowed}%)" >&2
  if [[ "$peak" -ge "$max_allowed" ]]; then
    echo "❌ k6 suite ($label): node CPU ${peak}% >= ${max_allowed}% — failing suite (set K6_SUITE_FAIL_ON_NODE_CPU=0 to warn only)" >&2
    return 3
  fi
  return 0
}

# Max CPU in millicores across pods whose name matches K6_SUITE_GATEWAY_DRAIN_NAME_SUBSTR (empty = unavailable / no match).
k6_suite_gateway_cpu_millicores_max() {
  local ns="${K6_SUITE_TOP_NS:-off-campus-housing-tracker}"
  local pat="${K6_SUITE_GATEWAY_DRAIN_NAME_SUBSTR:-api-gateway}"
  kubectl top pods -n "$ns" --no-headers 2>/dev/null | awk -v pat="$pat" '
    BEGIN { max = -1 }
    {
      pod = $1
      c = $2
      if (tolower(pod) !~ tolower(pat)) next
      if (c ~ /^[0-9]+m$/) {
        gsub(/m/, "", c)
        v = c + 0
      } else if (c ~ /^[0-9]+(\.[0-9]+)?$/) {
        v = (c + 0) * 1000
      } else {
        next
      }
      if (v > max) max = v
    }
    END {
      if (max < 0) print ""
      else printf "%.0f", max
    }
  '
}

k6_suite_kill_lingering_k6() {
  [[ "${K6_SUITE_KILL_K6_AFTER_BLOCK:-0}" == "1" ]] || return 0
  if command -v pgrep >/dev/null 2>&1 && pgrep -x k6 >/dev/null 2>&1; then
    echo "  k6 suite: SIGKILL lingering k6 process(es) (K6_SUITE_KILL_K6_AFTER_BLOCK=1)" >&2
    pkill -9 -x k6 2>/dev/null || true
  fi
  return 0
}

# Wait until gateway pods look idle (reduces back-to-back suite concurrency bleed through api-gateway).
k6_suite_wait_gateway_drain() {
  [[ "${K6_SUITE_GATEWAY_DRAIN:-0}" == "1" ]] || return 0
  local max_allowed="${K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES:-150}"
  local interval="${K6_SUITE_GATEWAY_DRAIN_INTERVAL_SEC:-2}"
  local timeout="${K6_SUITE_GATEWAY_DRAIN_TIMEOUT_SEC:-120}"
  local waited=0
  local cur
  cur=$(k6_suite_gateway_cpu_millicores_max)
  if [[ -z "$cur" ]]; then
    echo "⚠️  k6 suite: gateway drain skipped (no api-gateway row in kubectl top — metrics-server / pod name?)" >&2
    return 0
  fi
  echo "  k6 suite: gateway drain — waiting for api-gateway CPU < ${max_allowed}m (now ${cur}m, timeout ${timeout}s)" >&2
  while [[ "$cur" -gt "$max_allowed" ]]; do
    if [[ "$waited" -ge "$timeout" ]]; then
      echo "⚠️  k6 suite: gateway drain timeout (${timeout}s) at ${cur}m — continuing (set K6_SUITE_GATEWAY_DRAIN=0 to skip)" >&2
      return 0
    fi
    sleep "$interval"
    waited=$((waited + interval))
    cur=$(k6_suite_gateway_cpu_millicores_max)
    [[ -z "$cur" ]] && cur=0
  done
  echo "  k6 suite: gateway drain ok (api-gateway ≤ ${max_allowed}m)" >&2
  local extra="${K6_SUITE_POST_DRAIN_SLEEP_SEC:-0}"
  if [[ "$extra" =~ ^[0-9]+$ ]] && [[ "$extra" -gt 0 ]]; then
    echo "  k6 suite: post-drain sleep ${extra}s (K6_SUITE_POST_DRAIN_SLEEP_SEC)" >&2
    sleep "$extra"
  fi
  return 0
}

k6_suite_maybe_restart_envoy_after_car() {
  [[ "${K6_SUITE_RESTART_ENVOY_AFTER_CAR:-0}" != "1" ]] && return 0
  [[ "${1:-0}" != "1" ]] && return 0
  local ens="${K6_SUITE_ENVOY_NS:-envoy-test}"
  echo "  k6 suite: restarting deployment/envoy-test in ns $ens (K6_SUITE_RESTART_ENVOY_AFTER_CAR=1)" >&2
  kubectl rollout restart deployment/envoy-test -n "$ens" 2>/dev/null || echo "⚠️  envoy rollout restart skipped (missing deploy/ns?)" >&2
  sleep "${K6_SUITE_ENVOY_RESTART_SLEEP_SEC:-10}"
  local _es
  _es=$(
    echo ""
    echo "━━ post-envoy-restart snapshot ($(date -Iseconds)) ━━"
    kubectl top nodes 2>/dev/null || true
    kubectl top pods -n "${K6_SUITE_TOP_NS:-off-campus-housing-tracker}" --no-headers 2>/dev/null | head -40 || true
  )
  echo "$_es"
  echo "$_es" | k6_suite_append_log
}

# Args: $1 = label, $2 = is_constant_arrival (1 = extra cooldown + optional envoy)
k6_suite_after_k6_block() {
  local label="${1:-k6}"
  local is_car="${2:-0}"
  k6_suite_log_top "$label"
  k6_suite_check_node_cpu "$label" || return 3
  k6_suite_kill_lingering_k6
  k6_suite_wait_gateway_drain
  local cd="${K6_SUITE_COOLDOWN_SEC:-15}"
  echo "  k6 suite cooldown ${cd}s ($label)" >&2
  sleep "$cd"
  if [[ "$is_car" == "1" ]]; then
    k6_suite_maybe_restart_envoy_after_car 1
    local ex="${K6_SUITE_CAR_EXTRA_SEC:-20}"
    echo "  k6 suite constant-arrival-rate extra cooldown ${ex}s ($label)" >&2
    sleep "$ex"
  fi
  return 0
}
