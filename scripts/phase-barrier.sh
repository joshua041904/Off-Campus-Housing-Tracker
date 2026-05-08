#!/usr/bin/env bash
# Preflight Phase Barrier Contract — canonical transition guard between heavy phases.
# See docs/preflight-phase-barrier-contract.md. Does not stop unrelated long-running jobs.
#
# Workload vs Job semantics (v2 pod gate):
#   - Deployments / StatefulSets / DaemonSets: ready replicas must match desired (strict).
#   - Pods owned by a Job: Succeeded ignored; Failed always fails; Pending < PHASE_BARRIER_JOB_PENDING_GRACE_SEC ignored (JOB_GRACE);
#     Pending beyond grace fails (JOB_FAIL_PENDING); CrashLoopBackOff/Error/Unknown fail.
#   - Pods with metadata.labels.app in PHASE_BARRIER_REMEDIATION_APP_LABELS (default: kafka-dns-auto-remediator):
#     ignored unless Failed (ephemeral remediation / CronJob churn).
#   - Other pods: must be Running or Succeeded (WORKLOAD_FAIL_POD).
set -euo pipefail

PHASE_NAME="${1:-unknown}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
WATCHDOG_KEY="${PHASE_BARRIER_WATCHDOG_REDIS_KEY:-och:gw:watchdog_throttle}"
ROLLOUT_TIMEOUT="${PHASE_BARRIER_GATEWAY_ROLLOUT_TIMEOUT:-180}"
POST_GATEWAY_SLEEP="${PHASE_BARRIER_POST_GATEWAY_SLEEP_SEC:-5}"
TRAILING_STABILIZE="${PHASE_BARRIER_TRAILING_STABILIZE_SEC:-0}"
JOB_PENDING_GRACE_SEC="${PHASE_BARRIER_JOB_PENDING_GRACE_SEC:-60}"
REMEDIATION_APP_LABELS="${PHASE_BARRIER_REMEDIATION_APP_LABELS:-kafka-dns-auto-remediator}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "=== Phase Barrier — ${PHASE_NAME} ==="

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi
if ! kubectl cluster-info >/dev/null 2>&1; then
  warn "kubectl cluster not reachable — skipping remaining barrier steps"
  exit 0
fi

############################################
# 1. Cluster headroom (same semantics as cluster-stability-guard.sh)
############################################
if [[ "${PHASE_BARRIER_SKIP_CLUSTER_HEADROOM:-0}" != "1" ]]; then
  echo "Checking cluster headroom (metrics-server)..."
  MEM_FREE_MIN="${CLUSTER_GUARD_MEM_FREE_MIN:-20}"
  top_out=""
  for i in $(seq 1 "${CLUSTER_GUARD_METRICS_ATTEMPTS:-5}"); do
    if top_out="$(kubectl top nodes --no-headers 2>/dev/null)" && [[ -n "${top_out// }" ]]; then
      break
    fi
    [[ "$i" -lt 5 ]] && sleep "${CLUSTER_GUARD_METRICS_SLEEP_SEC:-3}"
  done
  if [[ -z "${top_out// }" ]]; then
    warn "kubectl top nodes unavailable — skipping headroom numbers (metrics-server?)"
  else
    _nodes="$(printf '%s\n' "$top_out" | awk 'NF {n++} END {print n+0}')"
    if [[ -n "${CLUSTER_GUARD_CPU_IDLE_MIN:-}" ]]; then
      CPU_IDLE_MIN="$CLUSTER_GUARD_CPU_IDLE_MIN"
    elif ((_nodes <= 1)); then
      CPU_IDLE_MIN="${CLUSTER_GUARD_CPU_IDLE_MIN_SINGLE:-10}"
    else
      CPU_IDLE_MIN="${CLUSTER_GUARD_CPU_IDLE_MIN_MULTI:-20}"
    fi
    node_count=0
    while read -r name cpu_cores cpu_pct mem_bytes mem_pct; do
      [[ -z "${name:-}" ]] && continue
      cpu_pct="${cpu_pct%%%}"
      mem_pct="${mem_pct%%%}"
      [[ "$cpu_pct" =~ ^[0-9]+$ ]] || {
        warn "Unexpected CPU% for ${name}: ${cpu_pct} — skipping strict headroom for this node"
        continue
      }
      [[ "$mem_pct" =~ ^[0-9]+$ ]] || {
        warn "Unexpected MEM% for ${name}: ${mem_pct} — skipping strict headroom for this node"
        continue
      }
      cpu_idle=$((100 - cpu_pct))
      mem_free=$((100 - mem_pct))
      node_count=$((node_count + 1))
      echo "  node=${name} cpu=${cpu_cores} mem=${mem_bytes} cpu_idle=${cpu_idle}% mem_free=${mem_free}%"
      if ((cpu_idle < CPU_IDLE_MIN)); then
        echo "❌ Node ${name} CPU headroom <${CPU_IDLE_MIN}% (idle=${cpu_idle}%)" >&2
        exit 1
      fi
      if ((mem_free < MEM_FREE_MIN)); then
        echo "❌ Node ${name} memory headroom <${MEM_FREE_MIN}% (free=${mem_free}%)" >&2
        exit 1
      fi
    done <<<"$top_out"
    if ((node_count == 0)); then
      warn "No node rows from kubectl top — skipping headroom enforcement"
    else
      ok "Cluster headroom OK (${node_count} node(s); cpu_idle>=${CPU_IDLE_MIN}%, mem_free>=${MEM_FREE_MIN}%)"
    fi
  fi
else
  info "Skipping cluster headroom (PHASE_BARRIER_SKIP_CLUSTER_HEADROOM=1)"
fi

############################################
# 2. Workload readiness + Job-aware pod gate (${NS})
############################################
if [[ "${PHASE_BARRIER_SKIP_POD_STABILITY:-0}" != "1" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    warn "jq not installed — skipping workload / pod stability check"
  else
    echo "Verifying workload controllers in namespace ${NS} (Deployment / StatefulSet / DaemonSet)..."
    _wl_json=""
    if _wl_json="$(kubectl get deploy,sts,ds -n "$NS" -o json 2>/dev/null)" && echo "$_wl_json" | jq -e '.items' >/dev/null 2>&1; then
      :
    else
      _wl_json="$(kubectl get deployment,statefulset,daemonset -n "$NS" -o json 2>/dev/null || echo '{"items":[]}')"
    fi
    _wl_fail="$(echo "$_wl_json" | jq -r '
      (.items // [])[] |
      (.kind // "") as $k | (.metadata.name) as $n |
      if $k == "Deployment" then
        (.spec.replicas // 0) as $w | (.status.readyReplicas // 0) as $r |
        if ($w | tonumber) > 0 and ($r | tonumber) < ($w | tonumber) then
          "WORKLOAD_FAIL \($k) \($n) ready=\($r) replicas=\($w)"
        else empty end
      elif $k == "StatefulSet" then
        (.spec.replicas // 0) as $w | (.status.readyReplicas // 0) as $r |
        if ($w | tonumber) > 0 and ($r | tonumber) < ($w | tonumber) then
          "WORKLOAD_FAIL \($k) \($n) ready=\($r) replicas=\($w)"
        else empty end
      elif $k == "DaemonSet" then
        (.status.desiredNumberScheduled // 0) as $w | (.status.numberReady // 0) as $r |
        if ($w | tonumber) > 0 and ($r | tonumber) < ($w | tonumber) then
          "WORKLOAD_FAIL \($k) \($n) numberReady=\($r) desired=\($w)"
        else empty end
      else empty end
    ')"
    if [[ -n "${_wl_fail// }" ]]; then
      echo "❌ Workload readiness failed in ${NS}" >&2
      printf '%s\n' "$_wl_fail" >&2
      exit 1
    fi
    ok "Workload readiness OK in ${NS} (Deployment / StatefulSet / DaemonSet)"

    echo "Verifying pod phases in ${NS} (Job-aware; grace=${JOB_PENDING_GRACE_SEC}s for Pending Job pods)..."
    _json="$(kubectl get pods -n "$NS" -o json 2>/dev/null || echo '{"items":[]}')"
    _pod_lines="$(echo "$_json" | jq -r --arg remediation "$REMEDIATION_APP_LABELS" --argjson grace "$JOB_PENDING_GRACE_SEC" '
      def from_ts(ts):
        if (ts == null or ts == "") then 0
        else
          (now - (
            ts
            | if test("\\.[0-9]+Z$") then sub("\\.[0-9]+Z$";"Z") else . end
            | fromdateiso8601
          ))
        end;
      ($remediation | split(",") | map(gsub("^ +| +$";""))) as $remapps |
      (.items // [])[] |
      . as $pod |
      ($pod.metadata.name) as $name |
      ($pod.status.phase) as $phase |
      (($pod.metadata.ownerReferences // []) | map(select(.kind == "Job")) | length > 0) as $jobpod |
      ($pod.metadata.labels.app // "") as $app |
      (($remapps | index($app)) != null) as $rem |
      (from_ts($pod.metadata.creationTimestamp)) as $age |
      if $jobpod then
        if $phase == "Succeeded" then empty
        elif $phase == "Failed" then "JOB_FAIL \($name) phase=Failed"
        elif $rem then "JOB_REMEDIATION_IGNORE \($name) app=\($app) phase=\($phase)"
        elif $phase == "Pending" and ($age < ($grace | tonumber)) then
          "JOB_GRACE \($name) phase=Pending age_sec=\($age | floor) grace_sec=\($grace)"
        elif $phase == "Pending" then
          "JOB_FAIL_PENDING \($name) phase=Pending age_sec=\($age | floor) grace_sec=\($grace)"
        elif ($phase == "CrashLoopBackOff" or $phase == "Error" or $phase == "Unknown") then
          "JOB_FAIL \($name) phase=\($phase)"
        else empty end
      else
        if $phase == "Succeeded" or $phase == "Running" then empty
        else "WORKLOAD_FAIL_POD \($name) phase=\($phase) (not owned by Job)"
        end
      end
    ')"
    _fail_pod=0
    while IFS= read -r _line; do
      [[ -z "${_line// }" ]] && continue
      case "$_line" in
        WORKLOAD_FAIL_POD*|JOB_FAIL*|JOB_FAIL_PENDING*)
          echo "❌ ${_line}" >&2
          _fail_pod=1
          ;;
        JOB_GRACE*)
          info "${_line}"
          ;;
        JOB_REMEDIATION_IGNORE*)
          info "${_line}"
          ;;
        *)
          echo "❌ ${_line}" >&2
          _fail_pod=1
          ;;
      esac
    done <<<"$_pod_lines"
    if [[ "$_fail_pod" == "1" ]]; then
      echo "❌ Pod phase gate failed in ${NS} (see WORKLOAD_FAIL_POD / JOB_* lines above)" >&2
      exit 1
    fi
    ok "Pod phase gate OK in ${NS} (Job grace + remediation label rules applied)"
  fi
else
  info "Skipping pod stability (PHASE_BARRIER_SKIP_POD_STABILITY=1)"
fi

############################################
# 3. Gateway drain (stateless reset: shaper inUse + waiters)
############################################
if [[ "${PHASE_BARRIER_SKIP_GATEWAY_RESTART:-0}" != "1" ]]; then
  if kubectl -n "$NS" get deploy/api-gateway &>/dev/null; then
    echo "Restarting api-gateway (clear in-process traffic shaper / connection churn)..."
    kubectl rollout restart deployment/api-gateway -n "$NS"
    kubectl rollout status deployment/api-gateway -n "$NS" --timeout="${ROLLOUT_TIMEOUT}s"
    sleep "$POST_GATEWAY_SLEEP"
    ok "api-gateway rollout complete"
  else
    warn "No deploy/api-gateway in ${NS} — skipping gateway restart"
  fi
else
  info "Skipping gateway restart (PHASE_BARRIER_SKIP_GATEWAY_RESTART=1)"
fi

############################################
# 4. Watchdog throttle key (best-effort DEL)
############################################
if [[ "${PHASE_BARRIER_SKIP_WATCHDOG_CLEAR:-0}" != "1" ]]; then
  echo "Clearing watchdog throttle key ${WATCHDOG_KEY} (best-effort)..."
  _cleared=0
  if [[ -n "${PHASE_BARRIER_WATCHDOG_REDIS_DEL_CMD:-}" ]]; then
    if bash -c "$PHASE_BARRIER_WATCHDOG_REDIS_DEL_CMD"; then
      _cleared=1
    else
      warn "PHASE_BARRIER_WATCHDOG_REDIS_DEL_CMD exited non-zero (continuing)"
    fi
  fi
  if [[ "$_cleared" != "1" ]] && kubectl -n "$NS" get deploy/redis &>/dev/null 2>&1; then
    if kubectl exec -n "$NS" deploy/redis -- sh -c "command -v redis-cli >/dev/null" 2>/dev/null; then
      kubectl exec -n "$NS" deploy/redis -- redis-cli DEL "$WATCHDOG_KEY" >/dev/null 2>&1 && _cleared=1 || true
    fi
  fi
  if [[ "$_cleared" == "1" ]]; then
    ok "Watchdog throttle key clear attempted (${WATCHDOG_KEY})"
  else
    info "No in-cluster redis exec path for DEL (external Redis is normal) — set PHASE_BARRIER_WATCHDOG_REDIS_DEL_CMD or clear key manually"
  fi
else
  info "Skipping watchdog clear (PHASE_BARRIER_SKIP_WATCHDOG_CLEAR=1)"
fi

############################################
# 5. Jaeger liveness (optional)
############################################
if [[ "${PHASE_BARRIER_SKIP_JAEGER:-0}" != "1" ]] && [[ -n "${JAEGER_QUERY_BASE:-}" ]]; then
  if [[ -x "$SCRIPT_DIR/verify-jaeger-liveness.sh" ]]; then
    JAEGER_QUERY_BASE="$JAEGER_QUERY_BASE" "$SCRIPT_DIR/verify-jaeger-liveness.sh"
  else
    echo "Checking Jaeger (${JAEGER_QUERY_BASE}/api/services)..."
    _jg_ok=0
    for i in $(seq 1 10); do
      if curl -sf --max-time 10 "${JAEGER_QUERY_BASE%/}/api/services" >/dev/null; then
        ok "Jaeger query API reachable"
        _jg_ok=1
        break
      fi
      echo "  waiting for Jaeger (attempt ${i}/10)..."
      [[ "$i" -lt 10 ]] && sleep 3
    done
    if [[ "$_jg_ok" != "1" ]]; then
      echo "❌ Jaeger unreachable after retries" >&2
      exit 1
    fi
  fi
elif [[ "${PHASE_BARRIER_SKIP_JAEGER:-0}" == "1" ]] && [[ -n "${JAEGER_QUERY_BASE:-}" ]]; then
  info "Skipping Jaeger check (PHASE_BARRIER_SKIP_JAEGER=1)"
elif [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  info "Skipping Jaeger check (JAEGER_QUERY_BASE unset)"
fi

if [[ "${TRAILING_STABILIZE}" =~ ^[0-9]+$ ]] && [[ "$TRAILING_STABILIZE" -gt 0 ]]; then
  info "Pool / TCP stabilize sleep: ${TRAILING_STABILIZE}s"
  sleep "$TRAILING_STABILIZE"
fi

ok "Phase barrier passed — ${PHASE_NAME}"
echo ""
