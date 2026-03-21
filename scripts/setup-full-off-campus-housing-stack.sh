#!/usr/bin/env bash
# Idiot-proof “command center”: Colima (optional) → Docker infra → dev certs (optional) → strict TLS bootstrap
# → DB bootstrap (optional) → Kafka event topics + verification → build/load images → deploy (kustomize) →
# housing secret bundle (och-*, Kafka client) → optional event-layer checks → optional full preflight.
#
# Does not keep generic NS= from your shell; unsets NS and uses HOUSING_NS / NAMESPACE for housing only.
#
# Usage:
#   ./scripts/setup-full-off-campus-housing-stack.sh
#
# Env (all optional):
#   HOUSING_NS=off-campus-housing-tracker   (default)
#   SKIP_COLIMA=1           skip setup-new-colima-cluster.sh (use existing cluster)
#   SKIP_BRINGUP_INFRA=1    skip bring-up-external-infra.sh
#   SKIP_AUTO_DEV_CERTS=1   do not run dev-generate-certs.sh when leaf cert missing
#   SKIP_STRICT_TLS_BOOTSTRAP=1  skip strict-tls-bootstrap.sh (secrets only from ensure-housing / preflight)
#   SKIP_DB_BOOTSTRAP=1     skip bootstrap-all-dbs.sh
#   SKIP_KAFKA_TOPICS=1     skip create-kafka-event-topics.sh + partition verify
#   SKIP_BUILD_IMAGES=1     skip build-housing-images-k3s.sh
#   SKIP_DEPLOY=1           skip deploy-dev.sh
#   SKIP_HOUSING_SECRETS=1  skip ensure-housing-cluster-secrets.sh
#   RUN_EVENT_LAYER=1       default on — run run-event-layer-verification.sh (Vitest + contracts + partition check)
#   RUN_PREFLIGHT=1         run run-preflight-scale-and-all-suites.sh after deploy (heavy)
#   PREFLIGHT_EXTRA         optional: extra args passed to preflight script (quoted string is not supported; use env vars on preflight instead)
#
set -euo pipefail
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

unset NS 2>/dev/null || true
export HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
export NAMESPACE="$HOUSING_NS"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
die() { echo "❌ $*" >&2; exit 1; }

LEAF="$REPO_ROOT/certs/off-campus-housing.local.crt"
CA="$REPO_ROOT/certs/dev-root.pem"

say "╔══════════════════════════════════════════════════════════════╗"
say "║  setup-full-off-campus-housing-stack (HOUSING_NS=$HOUSING_NS)   ║"
say "╚══════════════════════════════════════════════════════════════╝"

if [[ "${SKIP_COLIMA:-0}" != "1" ]]; then
  say "→ setup-new-colima-cluster.sh"
  "$SCRIPT_DIR/setup-new-colima-cluster.sh"
else
  warn "SKIP_COLIMA=1"
fi

if [[ "${SKIP_AUTO_DEV_CERTS:-0}" != "1" ]]; then
  if [[ ! -f "$LEAF" ]] || [[ ! -f "$CA" ]]; then
    say "→ dev-generate-certs.sh"
    "$SCRIPT_DIR/dev-generate-certs.sh"
  else
    ok "Dev leaf + CA present"
  fi
else
  [[ -f "$LEAF" ]] && [[ -f "$CA" ]] || die "Certs missing and SKIP_AUTO_DEV_CERTS=1 — add certs/ or unset SKIP_AUTO_DEV_CERTS"
fi

if [[ "${SKIP_BRINGUP_INFRA:-0}" != "1" ]]; then
  say "→ bring-up-external-infra.sh"
  "$SCRIPT_DIR/bring-up-external-infra.sh"
else
  warn "SKIP_BRINGUP_INFRA=1"
fi

if [[ "${SKIP_STRICT_TLS_BOOTSTRAP:-0}" != "1" ]]; then
  if [[ -x "$SCRIPT_DIR/strict-tls-bootstrap.sh" ]]; then
    say "→ strict-tls-bootstrap.sh"
    "$SCRIPT_DIR/strict-tls-bootstrap.sh"
  else
    warn "strict-tls-bootstrap.sh missing or not executable"
  fi
else
  warn "SKIP_STRICT_TLS_BOOTSTRAP=1"
fi

if [[ "${SKIP_DB_BOOTSTRAP:-0}" != "1" ]] && [[ -x "$SCRIPT_DIR/bootstrap-all-dbs.sh" ]]; then
  say "→ bootstrap-all-dbs.sh"
  "$SCRIPT_DIR/bootstrap-all-dbs.sh" || warn "bootstrap-all-dbs.sh failed (non-fatal)"
else
  warn "SKIP_DB_BOOTSTRAP=1 or bootstrap-all-dbs.sh missing"
fi

if [[ "${SKIP_KAFKA_TOPICS:-0}" != "1" ]]; then
  say "→ create-kafka-event-topics.sh"
  ENV_PREFIX=dev "$SCRIPT_DIR/create-kafka-event-topics.sh" || warn "create-kafka-event-topics failed (Kafka up?)"
  say "→ verify-proto-events-topics.sh"
  "$SCRIPT_DIR/verify-proto-events-topics.sh"
  say "→ verify-kafka-event-topic-partitions.sh"
  "$SCRIPT_DIR/verify-kafka-event-topic-partitions.sh" || warn "Partition verify skipped/failed"
else
  warn "SKIP_KAFKA_TOPICS=1"
fi

if [[ "${SKIP_BUILD_IMAGES:-0}" != "1" ]]; then
  say "→ build-housing-images-k3s.sh"
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
else
  warn "SKIP_BUILD_IMAGES=1"
fi

if [[ "${SKIP_DEPLOY:-0}" != "1" ]]; then
  say "→ deploy-dev.sh (NAMESPACE=$HOUSING_NS)"
  NAMESPACE="$HOUSING_NS" "$SCRIPT_DIR/deploy-dev.sh"
else
  warn "SKIP_DEPLOY=1"
fi

if [[ "${SKIP_HOUSING_SECRETS:-0}" != "1" ]]; then
  say "→ ensure-housing-cluster-secrets.sh"
  HOUSING_NS="$HOUSING_NS" "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
else
  warn "SKIP_HOUSING_SECRETS=1"
fi

if [[ "${RUN_EVENT_LAYER:-1}" == "1" ]]; then
  say "→ run-event-layer-verification.sh"
  "$SCRIPT_DIR/run-event-layer-verification.sh" || warn "Event-layer verification had warnings"
else
  warn "RUN_EVENT_LAYER=0"
fi

if [[ "${RUN_PREFLIGHT:-0}" == "1" ]]; then
  say "→ run-preflight-scale-and-all-suites.sh (heavy)"
  HOUSING_NS="$HOUSING_NS" "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"
else
  ok "Skipping preflight (set RUN_PREFLIGHT=1 for run-preflight-scale-and-all-suites.sh)"
fi

say "══════════════════════════════════════════════════════════════"
ok "setup-full-off-campus-housing-stack finished."
say "Next: RUN_PREFLIGHT=1 $0  — or  HOUSING_NS=$HOUSING_NS ./scripts/run-preflight-scale-and-all-suites.sh"
say "Docs: docs/FIRST_TIME_TEAM_SETUP.md · docs/RUN_PIPELINE_ORDER.md"
