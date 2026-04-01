#!/usr/bin/env bash
# Kafka ↔ MetalLB alignment validation suite (baseline + optional destructive chaos).
#
# Usage:
#   ./scripts/tests/kafka-alignment-suite.sh
# Env:
#   HOUSING_NS, KAFKA_BROKER_REPLICAS
#   KAFKA_ALIGNMENT_TEST_MODE=1 — run destructive/mutating tests (2–4, 6–7). Otherwise only safe tests (1 + 5).
#   KAFKA_ALIGNMENT_SKIP_TEST1_VERIFY=1 — test1 runs kafka-runtime-sync --check-only only (skip verify-kafka-cluster).
#   KAFKA_ALIGNMENT_PROM_FILE — override path for OpenMetrics (default: bench_logs/kafka-alignment-report/kafka_alignment_tests-<stamp>.prom)
#   NODE_EXPORTER_TEXTFILE_DIR — if set, copy metrics to DIR/kafka_alignment_tests.prom (node_exporter textfile collector)
#   PROMETHEUS_URL — optional; best-effort query after drift simulation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${KAFKA_ALIGNMENT_LOG:-$REPO_ROOT/bench_logs/kafka-alignment-suite-$STAMP.log}"
REPORT_DIR="$REPO_ROOT/bench_logs/kafka-alignment-report"
PROM_OUT="${KAFKA_ALIGNMENT_PROM_FILE:-$REPORT_DIR/kafka_alignment_tests-$STAMP.prom}"
KAFKA_C="${KAFKA_CONTAINER:-kafka}"

mkdir -p "$(dirname "$LOG")" "$REPORT_DIR"

RESULTS_FILE="$(mktemp)"
trap 'rm -f "$RESULTS_FILE"' EXIT

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*"; }
warn() { echo "⚠️  $*"; }

emit_result() {
  # $1=name $2=PASS|FAIL|SKIP $3=duration_sec
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$RESULTS_FILE"
  echo "KAFKA_ALIGNMENT_TEST test=$1 status=$2 duration_sec=$3"
}

exec > >(tee -a "$LOG") 2>&1

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { bad "openssl required (for TLS detection test)"; exit 1; }

chmod +x "$REPO_ROOT/scripts/verify-kafka-cluster.sh" \
  "$REPO_ROOT/scripts/kafka-runtime-sync.sh" \
  "$REPO_ROOT/scripts/verify-kafka-tls-sans.sh" \
  "$REPO_ROOT/scripts/kafka-refresh-tls-from-lb.sh" 2>/dev/null || true

TESTS_FAILED=0

write_prom_file() {
  mkdir -p "$(dirname "$PROM_OUT")"
  {
    echo "# HELP kafka_alignment_test_pass 1 if Kafka alignment suite test passed or was skipped (innocuous); 0 if failed"
    echo "# TYPE kafka_alignment_test_pass gauge"
    while IFS=$'\t' read -r name st dur; do
      [[ -z "$name" ]] && continue
      val=0
      if [[ "$st" == "PASS" ]] || [[ "$st" == "SKIP" ]]; then
        val=1
      fi
      echo "kafka_alignment_test_pass{test=\"${name}\"} ${val}"
    done <"$RESULTS_FILE"
  } >"$PROM_OUT"
  ok "Wrote metrics: $PROM_OUT"
  if [[ -n "${NODE_EXPORTER_TEXTFILE_DIR:-}" ]]; then
    mkdir -p "${NODE_EXPORTER_TEXTFILE_DIR}" || true
    local dest="${NODE_EXPORTER_TEXTFILE_DIR%/}/kafka_alignment_tests.prom"
    if cp -f "$PROM_OUT" "$dest" 2>/dev/null; then
      ok "Published metrics for node_exporter: $dest"
    else
      warn "NODE_EXPORTER_TEXTFILE_DIR set but copy to $dest failed (permissions?)"
    fi
  fi
}

print_summary() {
  say "=== Summary ==="
  printf "%-40s %8s %10s\n" "TEST" "STATUS" "DURATION_S"
  printf "%-40s %8s %10s\n" "----------------------------------------" "--------" "----------"
  while IFS=$'\t' read -r name st dur; do
    [[ -z "$name" ]] && continue
    printf "%-40s %8s %10s\n" "$name" "$st" "$dur"
  done <"$RESULTS_FILE"
}

mark_skip() {
  emit_result "$1" "SKIP" "0"
  warn "SKIP $1: $2"
}

# --- TEST 1: baseline ---
run_test1_baseline() {
  local name="baseline_healthy"
  SECONDS=0
  say "TEST 1 — Baseline healthy state"
  if [[ "${KAFKA_ALIGNMENT_SKIP_TEST1_VERIFY:-0}" == "1" ]]; then
    if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then
      emit_result "$name" "FAIL" "$SECONDS"
      return 1
    fi
  else
    if ! VERIFY_KAFKA_HEALTH_ONLY=0 \
      VERIFY_KAFKA_SKIP_META_IDENTITY=0 \
      VERIFY_KAFKA_SKIP_TLS_SANS=0 \
      VERIFY_KAFKA_SKIP_ADVERTISED=0 \
      VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=0 \
      VERIFY_KAFKA_SKIP_QUORUM_GATE=0 \
      VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=0 \
      VERIFY_KAFKA_SKIP_BROKER_API_GATE=0 \
      HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
      bash "$REPO_ROOT/scripts/verify-kafka-cluster.sh" "$NS" "$REP"; then
      emit_result "$name" "FAIL" "$SECONDS"
      return 1
    fi
    if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then
      emit_result "$name" "FAIL" "$SECONDS"
      return 1
    fi
  fi
  ok "TEST 1 passed"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test2_simulated_advert_drift() {
  local name="simulated_advert_drift_detect"
  SECONDS=0
  say "TEST 2 — Simulated advertised.listeners drift (kafka-0)"
  kubectl get pod kafka-0 -n "$NS" --request-timeout=20s >/dev/null 2>&1 || {
    bad "kafka-0 missing"
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  }
  kubectl exec -n "$NS" kafka-0 -c "$KAFKA_C" --request-timeout=45s -- sh -c \
    'f=/etc/kafka/kafka.properties && test -f "$f" && cp -f "$f" "${f}.suite.bak" && sed -i.bak "s|EXTERNAL://[0-9][0-9]*\\.[0-9][0-9]*\\.[0-9][0-9]*\\.[0-9][0-9]*:9094|EXTERNAL://1.2.3.4:9094|g" "$f"' \
    || {
      bad "Could not patch kafka.properties"
      emit_result "$name" "FAIL" "$SECONDS"
      return 1
    }
  set +e
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    bad "Expected drift detection (non-zero exit)"
    kubectl exec -n "$NS" kafka-0 -c "$KAFKA_C" --request-timeout=45s -- sh -c \
      'test -f /etc/kafka/kafka.properties.suite.bak && cp -f /etc/kafka/kafka.properties.suite.bak /etc/kafka/kafka.properties' 2>/dev/null || true
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 2 passed (drift detected, exit $rc)"
  if [[ -n "${PROMETHEUS_URL:-}" ]] && command -v curl >/dev/null 2>&1; then
    curl -sfG --data-urlencode "query=max(kafka_runtime_config_drift)" "${PROMETHEUS_URL%/}/api/v1/query" >/dev/null 2>&1 \
      && ok "Prometheus drift query OK" || warn "Prometheus query skipped or failed"
  fi
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test3_remediate() {
  local name="auto_remediate"
  SECONDS=0
  say "TEST 3 — Auto-remediation (kafka-runtime-sync --remediate)"
  if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then
    kubectl exec -n "$NS" kafka-0 -c "$KAFKA_C" --request-timeout=45s -- sh -c \
      'test -f /etc/kafka/kafka.properties.suite.bak && cp -f /etc/kafka/kafka.properties.suite.bak /etc/kafka/kafka.properties' 2>/dev/null || true
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 3 passed"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test4_metallb_svc_churn() {
  local name="metallb_external_svc_churn"
  SECONDS=0
  say "TEST 4 — MetalLB external Service delete + restore (kafka-1-external)"
  if [[ ! -d "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" ]]; then
    bad "Missing infra/k8s/kafka-kraft-metallb — cannot restore Service safely"
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  kubectl delete svc kafka-1-external -n "$NS" --ignore-not-found --request-timeout=45s
  sleep 5
  kubectl apply -k "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" --request-timeout=90s
  say "Waiting for LB IP on kafka-1-external…"
  local w=0
  local ip=""
  while [[ "$w" -lt 120 ]]; do
    ip="$(kubectl get svc kafka-1-external -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$ip" ]] && echo "$ip" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
      break
    fi
    sleep 2
    w=$((w + 2))
  done
  set +e
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"
  _drift_rc=$?
  set -e
  if [[ "$_drift_rc" -eq 0 ]]; then
    warn "Check-only still passed after LB churn — continuing to remediation anyway"
  fi
  if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 4 passed"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test5_tls_detection() {
  local name="tls_drift_detection"
  SECONDS=0
  say "TEST 5 — TLS SAN mismatch detection (local bad PEM)"
  local bad_pem tmp_cnf keyf
  bad_pem="$(mktemp)"
  keyf="$(mktemp)"
  tmp_cnf="$(mktemp)"
  cat >"$tmp_cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN=kafka-alignment-bad
[v3_req]
subjectAltName=DNS:localhost
EOF
  openssl req -x509 -newkey rsa:2048 -keyout "$keyf" -out "$bad_pem" -days 1 -nodes \
    -config "$tmp_cnf" -extensions v3_req 2>/dev/null || {
    rm -f "$bad_pem" "$keyf" "$tmp_cnf"
    bad "openssl could not generate bad PEM"
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  }
  set +e
  KAFKA_TLS_PEM="$bad_pem" HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
    bash "$REPO_ROOT/scripts/verify-kafka-tls-sans.sh" "$NS" "$REP"
  tls_rc=$?
  set -e
  rm -f "$bad_pem" "$keyf" "$tmp_cnf"
  if [[ "$tls_rc" -eq 0 ]]; then
    bad "Expected verify-kafka-tls-sans to fail on bad PEM"
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 5 passed (TLS verifier rejected bad cert)"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test6_broker_restart() {
  local name="broker_pod_restart_resilience"
  SECONDS=0
  local last=$((REP - 1))
  [[ "$last" -lt 0 ]] && last=0
  say "TEST 6 — Delete kafka-${last} pod, wait Ready, re-check alignment"
  kubectl delete pod "kafka-${last}" -n "$NS" --request-timeout=45s
  kubectl wait pod "kafka-${last}" -n "$NS" --for=condition=ready --timeout=300s
  if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 6 passed"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

run_test7_rollout() {
  local name="full_cluster_rollout_resilience"
  SECONDS=0
  say "TEST 7 — Rollout restart statefulset/kafka"
  kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=45s
  kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_ROLLOUT_TIMEOUT:-600s}"
  if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then
    emit_result "$name" "FAIL" "$SECONDS"
    return 1
  fi
  ok "TEST 7 passed"
  emit_result "$name" "PASS" "$SECONDS"
  return 0
}

say "=== Kafka alignment suite (ns=$NS replicas=$REP) log=$LOG ==="
say "KAFKA_ALIGNMENT_TEST_MODE=${KAFKA_ALIGNMENT_TEST_MODE:-0}"

run_test1_baseline || TESTS_FAILED=$((TESTS_FAILED + 1))
run_test5_tls_detection || TESTS_FAILED=$((TESTS_FAILED + 1))

if [[ "${KAFKA_ALIGNMENT_TEST_MODE:-0}" != "1" ]]; then
  mark_skip "simulated_advert_drift_detect" "KAFKA_ALIGNMENT_TEST_MODE!=1"
  mark_skip "auto_remediate" "KAFKA_ALIGNMENT_TEST_MODE!=1"
  mark_skip "metallb_external_svc_churn" "KAFKA_ALIGNMENT_TEST_MODE!=1"
  mark_skip "broker_pod_restart_resilience" "KAFKA_ALIGNMENT_TEST_MODE!=1"
  mark_skip "full_cluster_rollout_resilience" "KAFKA_ALIGNMENT_TEST_MODE!=1"
else
  run_test2_simulated_advert_drift || TESTS_FAILED=$((TESTS_FAILED + 1))
  run_test3_remediate || TESTS_FAILED=$((TESTS_FAILED + 1))
  run_test4_metallb_svc_churn || TESTS_FAILED=$((TESTS_FAILED + 1))
  run_test6_broker_restart || TESTS_FAILED=$((TESTS_FAILED + 1))
  run_test7_rollout || TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary
write_prom_file || true

python3 "$REPO_ROOT/scripts/generate-kafka-alignment-report.py" --log "$LOG" --out-dir "$REPORT_DIR" --stamp "$STAMP" || warn "Report generator failed (non-fatal)"

if [[ "$TESTS_FAILED" -gt 0 ]]; then
  bad "Suite finished with $TESTS_FAILED failing test(s)"
  exit 1
fi
ok "Kafka alignment suite: all executed tests passed"
exit 0
