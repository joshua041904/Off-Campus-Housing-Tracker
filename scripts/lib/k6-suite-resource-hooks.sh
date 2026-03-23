#!/usr/bin/env bash
# Sourced by k6 orchestration scripts (not executed directly).
# Cooldown + cluster visibility after each k6 block to reduce cross-test contention (Colima/k3s).
#
# Env (all optional):
#   K6_SUITE_COOLDOWN_SEC=15           — sleep after every k6 block
#   K6_SUITE_CAR_EXTRA_SEC=20          — extra sleep after constant-arrival-rate style tests (in addition to cooldown)
#   K6_SUITE_LOG_TOP=1                 — log kubectl top nodes + pods after each block
#   K6_SUITE_FAIL_ON_NODE_CPU=1        — exit 3 if any node CPU% >= threshold (0 = warn only)
#   K6_SUITE_NODE_CPU_MAX=85           — fail threshold (percent)
#   K6_SUITE_TOP_NS=off-campus-housing-tracker
#   K6_SUITE_TOP_ENVOY_NS=envoy-test   — also snapshot top pods in this ns (empty to skip)
#   K6_SUITE_RESTART_ENVOY_AFTER_CAR=0 — if 1, after CAR tests: rollout restart envoy-test + sleep

k6_suite_log_top() {
  local label="${1:-post-k6}"
  [[ "${K6_SUITE_LOG_TOP:-1}" != "1" ]] && return 0
  echo ""
  echo "━━ k6 suite resource snapshot: $label ━━"
  kubectl top nodes 2>/dev/null || echo "  (kubectl top nodes unavailable — metrics-server?)"
  local ns="${K6_SUITE_TOP_NS:-off-campus-housing-tracker}"
  kubectl top pods -n "$ns" --no-headers 2>/dev/null | head -60 || echo "  (kubectl top pods -n $ns unavailable)"
  local ens="${K6_SUITE_TOP_ENVOY_NS:-envoy-test}"
  if [[ -n "$ens" ]]; then
    kubectl top pods -n "$ens" --no-headers 2>/dev/null | head -30 || true
  fi
}

# Returns 0 if OK or check skipped; 3 if CPU over threshold (caller should fail suite).
k6_suite_check_node_cpu() {
  local label="${1:-}"
  [[ "${K6_SUITE_FAIL_ON_NODE_CPU:-1}" != "1" ]] && return 0
  local max_allowed="${K6_SUITE_NODE_CPU_MAX:-85}"
  local top_out
  top_out=$(kubectl top nodes --no-headers 2>/dev/null) || {
    echo "⚠️  k6 suite ($label): skip node CPU check (kubectl top nodes failed — metrics-server?)"
    return 0
  }
  [[ -z "$top_out" ]] && return 0
  # Column 3 is CPU% in standard kubectl top nodes output (NAME, CPU(cores), CPU%, ...)
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
    echo "⚠️  k6 suite ($label): could not parse node CPU%% from kubectl top — not failing"
    return 0
  fi
  echo "  k6 suite: peak node CPU%=${peak}% (threshold ${max_allowed}%)"
  if [[ "$peak" -ge "$max_allowed" ]]; then
    echo "❌ k6 suite ($label): node CPU ${peak}% >= ${max_allowed}% — failing suite (set K6_SUITE_FAIL_ON_NODE_CPU=0 to warn only)"
    return 3
  fi
  return 0
}

k6_suite_maybe_restart_envoy_after_car() {
  [[ "${K6_SUITE_RESTART_ENVOY_AFTER_CAR:-0}" != "1" ]] && return 0
  [[ "${1:-0}" != "1" ]] && return 0
  local ens="${K6_SUITE_ENVOY_NS:-envoy-test}"
  echo "  k6 suite: restarting deployment/envoy-test in ns $ens (K6_SUITE_RESTART_ENVOY_AFTER_CAR=1)"
  kubectl rollout restart deployment/envoy-test -n "$ens" 2>/dev/null || echo "⚠️  envoy rollout restart skipped (missing deploy/ns?)"
  sleep "${K6_SUITE_ENVOY_RESTART_SLEEP_SEC:-10}"
}

# Args: $1 = label, $2 = is_constant_arrival (1 = extra cooldown + optional envoy)
k6_suite_after_k6_block() {
  local label="${1:-k6}"
  local is_car="${2:-0}"
  k6_suite_log_top "$label"
  k6_suite_check_node_cpu "$label" || return 3
  local cd="${K6_SUITE_COOLDOWN_SEC:-15}"
  echo "  k6 suite cooldown ${cd}s ($label)"
  sleep "$cd"
  if [[ "$is_car" == "1" ]]; then
    k6_suite_maybe_restart_envoy_after_car 1
    local ex="${K6_SUITE_CAR_EXTRA_SEC:-20}"
    echo "  k6 suite constant-arrival-rate extra cooldown ${ex}s ($label)"
    sleep "$ex"
  fi
  return 0
}
