#!/usr/bin/env bash
# "Ship it" golden snapshot: rebuild all housing :dev images (Colima load), restart workloads, verify Kafka alignment.
# Prefer this over ad-hoc loops — uses the same service list as build-housing-images-k3s.sh.
#
# Usage (repo root, Docker + kubectl + optional Colima):
#   ./scripts/golden-snapshot-verify.sh
#   SKIP_BUILD=1 ./scripts/golden-snapshot-verify.sh          # verify only (no docker build)
#   GOLDEN_SNAPSHOT_RESTART_KAFKA=0 ./scripts/golden-snapshot-verify.sh
#   GOLDEN_SNAPSHOT_CHAOS=1 ./scripts/golden-snapshot-verify.sh # destructive alignment suite + make chaos-suite-kafka
#   GOLDEN_SNAPSHOT_RESTART_ALL_DEPLOYMENTS=0 …                 # skip blanket deploy restart (after rebuild-all rollouts only)
#
# Env: HOUSING_NS, same as rebuild-all-housing-images-k3s.sh (IMAGE_TAG, SKIP_LOAD, DOCKER_DEFAULT_PLATFORM, …)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== golden-snapshot-verify (ns=$NS) ==="

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  say "Step 1 — Rebuild all housing images + Colima load + per-service rollouts"
  bash "$SCRIPT_DIR/rebuild-all-housing-images-k3s.sh"
else
  warn "SKIP_BUILD=1 — skipping rebuild-all-housing-images-k3s.sh"
fi

_rollouts_ok=0
if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found — skipping cluster rollouts (kafka-health will fail if cluster checks are required)"
elif kubectl get ns "$NS" --request-timeout=15s >/dev/null 2>&1; then
  _rollouts_ok=1
else
  warn "Namespace $NS not reachable — skipping cluster rollouts (kafka-health / alignment may fail below)"
fi

if [[ "$_rollouts_ok" == "1" ]] && [[ "${GOLDEN_SNAPSHOT_RESTART_ALL_DEPLOYMENTS:-1}" == "1" ]]; then
  say "Step 2 — Rollout restart all Deployments in $NS"
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    kubectl rollout restart "deployment/$d" -n "$NS" --request-timeout=45s || warn "restart failed: $d"
  done < <(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  ok "Deployment restarts triggered"
elif [[ "$_rollouts_ok" == "1" ]]; then
  warn "GOLDEN_SNAPSHOT_RESTART_ALL_DEPLOYMENTS=0 — skipping blanket deployment restart"
fi

if [[ "$_rollouts_ok" == "1" ]] && [[ "${GOLDEN_SNAPSHOT_RESTART_KAFKA:-1}" == "1" ]]; then
  say "Step 3 — Rollout restart statefulset/kafka"
  if kubectl get statefulset kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
    kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=60s
    kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_ROLLOUT_TIMEOUT:-600s}" || warn "kafka rollout status timed out or failed"
  else
    warn "No statefulset/kafka in $NS — skip"
  fi
elif [[ "$_rollouts_ok" == "1" ]]; then
  warn "GOLDEN_SNAPSHOT_RESTART_KAFKA=0 — skipping Kafka StatefulSet restart"
fi

if [[ "$_rollouts_ok" == "1" ]] && [[ "${GOLDEN_SNAPSHOT_WAIT_DEPLOYMENTS:-1}" == "1" ]]; then
  say "Step 4 — Wait for Deployments (best-effort)"
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    kubectl rollout status "deployment/$d" -n "$NS" --timeout="${GOLDEN_SNAPSHOT_DEPLOY_TIMEOUT:-240s}" 2>/dev/null || warn "wait: $d"
  done < <(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
fi

say "Step 5 — make kafka-health"
make -C "$REPO_ROOT" kafka-health

say "Step 6 — make kafka-alignment-suite"
if [[ "${GOLDEN_SNAPSHOT_CHAOS:-0}" == "1" ]]; then
  say "(GOLDEN_SNAPSHOT_CHAOS=1 — KAFKA_ALIGNMENT_TEST_MODE=1)"
  KAFKA_ALIGNMENT_TEST_MODE=1 make -C "$REPO_ROOT" kafka-alignment-suite
else
  make -C "$REPO_ROOT" kafka-alignment-suite
fi

if [[ "${GOLDEN_SNAPSHOT_CHAOS:-0}" == "1" ]]; then
  say "Step 7 — make chaos-suite-kafka (destructive)"
  make -C "$REPO_ROOT" chaos-suite-kafka
else
  warn "GOLDEN_SNAPSHOT_CHAOS not set — steps 6–7 used safe alignment only; set GOLDEN_SNAPSHOT_CHAOS=1 for destructive alignment + chaos-suite-kafka"
fi

ok "golden-snapshot-verify complete"
