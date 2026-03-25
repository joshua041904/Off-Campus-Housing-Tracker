#!/usr/bin/env bash
# Phase D (Issues 9 & 10): tail + cross-service lab — wired from run-preflight-scale-and-all-suites.sh
# when PREFLIGHT_PHASE_D_TAIL_LAB is enabled.
#
# Steps (best-effort where host DBs are absent):
#   1) Optional: ./scripts/ensure-listings-schema.sh (local listings on PGPORT, default 5442)
#   2) ./scripts/perf/run-all-explain.sh → $OUT/explain-all.md
#   3) Optional: cross-service isolation (long) when PREFLIGHT_PHASE_D_CROSS_ISO=1
#   4) k6 listings concurrency (VUS from PREFLIGHT_PHASE_D_LISTINGS_VUS, default 20)
#   5) k6 analytics public
#   6) k6 dual contention analytics+listings
#   7) Optional: pg lock snapshots → $OUT/pg-locks-*.txt when PREFLIGHT_PHASE_D_PG_SNAPSHOT=1 (best-effort)
#
# Requires: k6, certs/dev-root.pem, edge DNS, kubectl (for hooks). Host DBs optional for EXPLAIN + schema.
#
# Env:
#   PREFLIGHT_PHASE_D_OUT              — output dir (default bench_logs/preflight-phase-d-<ts>)
#   PREFLIGHT_PHASE_D_SKIP_SCHEMA      — 1 = skip ensure-listings-schema.sh
#   PREFLIGHT_PHASE_D_SKIP_EXPLAIN     — 1 = skip run-all-explain.sh
#   PREFLIGHT_PHASE_D_CROSS_ISO        — 1 = run run-k6-cross-service-isolation.sh (long)
#   PREFLIGHT_PHASE_D_LISTINGS_VUS     — default 20
#   PREFLIGHT_PHASE_D_PG_SNAPSHOT      — 1 = run snapshot-pg-locks.sh for listings + analytics ports
#   PGHOST / PGPASSWORD / PGPORT       — listings schema + explain (5442–5448 per DB)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=../lib/edge-test-url.sh
source "$REPO_ROOT/scripts/lib/edge-test-url.sh"

OUT="${PREFLIGHT_PHASE_D_OUT:-$REPO_ROOT/bench_logs/preflight-phase-d-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
case "${PREFLIGHT_PHASE_D_TAIL_LAB:-0}" in
  full)
    export PREFLIGHT_PHASE_D_CROSS_ISO="${PREFLIGHT_PHASE_D_CROSS_ISO:-1}"
    ;;
esac
export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"
export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
BASE_URL="$(edge_normalize_k6_base_url)" || true

{
  echo "# Preflight Phase D tail lab"
  echo "Started: $(date -Iseconds)"
  echo "OUT=$OUT"
  echo "BASE_URL=$BASE_URL"
} | tee "$OUT/MANIFEST.txt"

if [[ -f "$REPO_ROOT/scripts/lib/k6-suite-resource-hooks.sh" ]]; then
  # shellcheck source=../lib/k6-suite-resource-hooks.sh
  source "$REPO_ROOT/scripts/lib/k6-suite-resource-hooks.sh"
fi

_run_hooks_before() {
  declare -F k6_suite_before_k6_block >/dev/null 2>&1 && k6_suite_before_k6_block "$1" 2>/dev/null || true
}
_run_hooks_after() {
  declare -F k6_suite_after_k6_block >/dev/null 2>&1 && k6_suite_after_k6_block "$1" 0 2>/dev/null || true
}

if [[ "${PREFLIGHT_PHASE_D_SKIP_SCHEMA:-0}" != "1" ]]; then
  say_schema() { printf "\n\033[1m%s\033[0m\n" "$*"; }
  say_schema "Phase D — ensure listings schema (local postgres-listings :${PGPORT:-5442})"
  chmod +x "$REPO_ROOT/scripts/ensure-listings-schema.sh" 2>/dev/null || true
  if PGPASSWORD="${PGPASSWORD:-postgres}" PGPORT="${PGPORT:-5442}" PGHOST="${PGHOST:-127.0.0.1}" \
    "$REPO_ROOT/scripts/ensure-listings-schema.sh" >>"$OUT/ensure-listings-schema.log" 2>&1; then
    echo "ensure-listings-schema: OK" >>"$OUT/MANIFEST.txt"
  else
    echo "ensure-listings-schema: SKIP or FAIL (no host listings DB — see ensure-listings-schema.log)" | tee -a "$OUT/MANIFEST.txt"
  fi
else
  echo "ensure-listings-schema: skipped (PREFLIGHT_PHASE_D_SKIP_SCHEMA=1)" >>"$OUT/MANIFEST.txt"
fi

if [[ "${PREFLIGHT_PHASE_D_SKIP_EXPLAIN:-0}" != "1" ]]; then
  printf "\n\033[1m%s\033[0m\n" "Phase D — EXPLAIN all reachable DBs → explain-all.md"
  chmod +x "$REPO_ROOT/scripts/perf/run-all-explain.sh" 2>/dev/null || true
  PGHOST="${PGHOST:-127.0.0.1}" PGPASSWORD="${PGPASSWORD:-postgres}" \
    "$REPO_ROOT/scripts/perf/run-all-explain.sh" "$OUT/explain-all.md" 2>&1 | tee "$OUT/run-all-explain.log" || true
else
  echo "run-all-explain: skipped (PREFLIGHT_PHASE_D_SKIP_EXPLAIN=1)" >>"$OUT/MANIFEST.txt"
fi

if [[ "${PREFLIGHT_PHASE_D_CROSS_ISO:-0}" == "1" ]]; then
  printf "\n\033[1m%s\033[0m\n" "Phase D — cross-service isolation (long)"
  chmod +x "$REPO_ROOT/scripts/perf/run-k6-cross-service-isolation.sh" 2>/dev/null || true
  export K6_ISO_OUT="$OUT/k6-cross-service-isolation"
  if [[ "$(uname -s)" == "Darwin" ]] && [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ -f "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" ]]; then
    "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" || true
  fi
  SSL_CERT_FILE="$SSL_CERT_FILE" K6_ISO_OUT="$K6_ISO_OUT" \
    "$REPO_ROOT/scripts/perf/run-k6-cross-service-isolation.sh" 2>&1 | tee "$OUT/k6-cross-service-isolation.log" || true
else
  echo "cross-service isolation: skipped (set PREFLIGHT_PHASE_D_CROSS_ISO=1 to run)" >>"$OUT/MANIFEST.txt"
fi

command -v k6 >/dev/null 2>&1 || {
  echo "k6 not on PATH — Phase D k6 steps skipped" | tee -a "$OUT/MANIFEST.txt"
  exit 0
}

[[ -s "$SSL_CERT_FILE" ]] || {
  echo "Missing CA: $SSL_CERT_FILE — Phase D k6 skipped" | tee -a "$OUT/MANIFEST.txt"
  exit 0
}

if [[ "$(uname -s)" == "Darwin" ]] && [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ -f "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" ]]; then
  "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" || true
fi

_LVUS="${PREFLIGHT_PHASE_D_LISTINGS_VUS:-20}"

printf "\n\033[1m%s\033[0m\n" "Phase D — k6 listings concurrency (VUS=$_LVUS)"
_run_hooks_before "phase-d-k6-listings-concurrency"
SSL_CERT_FILE="$SSL_CERT_FILE" VUS="$_LVUS" k6 run "$REPO_ROOT/scripts/load/k6-listings-concurrency.js" 2>&1 | tee "$OUT/k6-listings-concurrency.log" || true
_run_hooks_after "phase-d-after-k6-listings-concurrency"

printf "\n\033[1m%s\033[0m\n" "Phase D — k6 analytics public"
_run_hooks_before "phase-d-k6-analytics-public"
SSL_CERT_FILE="$SSL_CERT_FILE" VUS="${PREFLIGHT_PHASE_D_ANALYTICS_VUS:-8}" DURATION="${PREFLIGHT_PHASE_D_ANALYTICS_DURATION:-28s}" \
  k6 run "$REPO_ROOT/scripts/load/k6-analytics-public.js" 2>&1 | tee "$OUT/k6-analytics-public.log" || true
_run_hooks_after "phase-d-after-k6-analytics-public"

printf "\n\033[1m%s\033[0m\n" "Phase D — k6 dual contention (analytics+listings)"
_run_hooks_before "phase-d-k6-dual-analytics-listings"
SSL_CERT_FILE="$SSL_CERT_FILE" DUAL_PAIR=analytics+listings \
  k6 run "$REPO_ROOT/scripts/perf/k6-dual-service-contention.js" 2>&1 | tee "$OUT/k6-dual-analytics-listings.log" || true
_run_hooks_after "phase-d-after-k6-dual-analytics-listings"

if [[ "${PREFLIGHT_PHASE_D_PG_SNAPSHOT:-0}" == "1" ]]; then
  chmod +x "$REPO_ROOT/scripts/perf/snapshot-pg-locks.sh" 2>/dev/null || true
  PGPORT="${PGPORT:-5442}" PGPASSWORD="${PGPASSWORD:-postgres}" \
    "$REPO_ROOT/scripts/perf/snapshot-pg-locks.sh" listings >"$OUT/pg-locks-listings.txt" 2>&1 || true
  PGPORT="${PREFLIGHT_PHASE_D_ANALYTICS_PGPORT:-5447}" PGPASSWORD="${PGPASSWORD:-postgres}" \
    "$REPO_ROOT/scripts/perf/snapshot-pg-locks.sh" analytics >"$OUT/pg-locks-analytics.txt" 2>&1 || true
fi

printf "\n\033[1m%s\033[0m\n" "Phase D — done. Artifacts under $OUT"
echo "Finished: $(date -Iseconds)" >>"$OUT/MANIFEST.txt"
exit 0
