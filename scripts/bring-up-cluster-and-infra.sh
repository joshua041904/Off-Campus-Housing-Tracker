#!/usr/bin/env bash
# One-shot: bring up Colima cluster (MetalLB pool), external infra (8 Postgres, Redis, MinIO — no Compose Kafka; Kafka is in-cluster KRaft), then compose + bootstrap.
# Use so no one gets lost — single entrypoint for "cluster + infra + DBs ready." Apply KRaft separately (e.g. make apply-kafka-kraft) before workloads need Kafka.
#
# Usage:
#   ./scripts/bring-up-cluster-and-infra.sh
#   RESTORE_BACKUP_DIR=latest ./scripts/bring-up-cluster-and-infra.sh
#   RESTORE_BACKUP_DIR=backups/all-8-20260318-174510 ./scripts/bring-up-cluster-and-infra.sh
#
# Env:
#   RESTORE_BACKUP_DIR   — passed to bring-up-external-infra.sh → restore-external-postgres-from-backup.sh (all-8 dumps).
#                          When set, SKIP_BOOTSTRAP defaults to 1: dumps are authoritative (no infra/db SQL bootstrap).
#                          To layer SQL on top of a restore: FORCE_SQL_BOOTSTRAP=1 or SKIP_BOOTSTRAP=0.
#   SKIP_CLUSTER=1       — skip setup-new-colima-cluster.sh (e.g. Colima already up)
#   SKIP_COMPOSE=1       — skip docker compose up -d (e.g. already up)
#   SKIP_BOOTSTRAP=1     — skip bootstrap-after-bring-up.sh (default when RESTORE_BACKUP_DIR is set)
#   FORCE_SQL_BOOTSTRAP=1 — run bootstrap-after-bring-up even after a dump restore (unusual)
#   SKIP_VERIFY=1        — skip verify-bootstrap.sh and inspect-external-db-schemas.sh
#   VERIFY_AFTER_DUMP_RESTORE=1 — when SKIP_BOOTSTRAP=1 (dump path), still run verify + inspect (default: skip)
#
# Order: (1) setup-new-colima-cluster.sh, (2) bring-up-external-infra.sh (+ optional dump restore), (3) docker compose up -d,
#        (4) bootstrap-after-bring-up.sh unless skipped, (5) verify + inspect (unless SKIP_VERIFY).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

say "=== Bring up cluster and external infra (single entrypoint) ==="
info "RESTORE_BACKUP_DIR=${RESTORE_BACKUP_DIR:-}(unset = SQL bootstrap from infra/db only; set to latest/path for all-8 dump restore — then bootstrap is skipped by default)"

# Dump restore carries full schemas; do not re-run infra/db SQL unless explicitly requested.
# SKIP_BOOTSTRAP=1 from env (e.g. dev-onboard after Phase-0 dump restore) always skips SQL bootstrap.
if [[ "${SKIP_BOOTSTRAP:-0}" == "1" ]]; then
  info "SKIP_BOOTSTRAP=1 — will skip bootstrap-after-bring-up.sh (dump-only or external Phase-0 restore)."
elif [[ -n "${RESTORE_BACKUP_DIR:-}" ]] && [[ "${FORCE_SQL_BOOTSTRAP:-0}" != "1" ]]; then
  SKIP_BOOTSTRAP=1
  info "RESTORE_BACKUP_DIR set → SKIP_BOOTSTRAP=1 (dump-only DBs). FORCE_SQL_BOOTSTRAP=1 to run bootstrap-after-bring-up.sh anyway."
fi

# 1) Colima + k3s + MetalLB (251–260)
if [[ "${SKIP_CLUSTER:-0}" != "1" ]]; then
  say "Step 1: Colima cluster (k3s + MetalLB pool 251–260)"
  ./scripts/setup-new-colima-cluster.sh
  ok "Cluster ready"
else
  info "SKIP_CLUSTER=1: skipping setup-new-colima-cluster.sh"
fi

# 2) External infra (Redis, MinIO, 8 Postgres); optional restore from backup — Kafka is not on Compose
say "Step 2: External infra (Redis, MinIO, 8 Postgres)"
if [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
  export RESTORE_BACKUP_DIR
  info "RESTORE_BACKUP_DIR=$RESTORE_BACKUP_DIR will be used by bring-up-external-infra.sh (restore after Postgres healthy)"
fi
./scripts/bring-up-external-infra.sh
ok "External infra up"

# 3) Docker compose (ensure all containers up; may already be from step 2)
if [[ "${SKIP_COMPOSE:-0}" != "1" ]]; then
  say "Step 3: Docker compose up -d"
  docker compose up -d
  ok "Compose up"
else
  info "SKIP_COMPOSE=1: skipping docker compose up -d"
fi

# 4) Optional: infra/db SQL bootstrap + legacy 5437-auth.dump (skipped when RESTORE_BACKUP_DIR set unless FORCE_SQL_BOOTSTRAP=1)
if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
  say "Step 4: Bootstrap DBs from infra/db (and optional backups/5437-auth.dump)"
  PGPASSWORD=postgres ./scripts/bootstrap-after-bring-up.sh
  ok "Bootstrap done"
else
  info "SKIP_BOOTSTRAP=1: skipping bootstrap-after-bring-up.sh"
fi

# verify-bootstrap targets infra/db bootstrap expectations; all-8 dumps may differ — default skip unless asked.
if [[ "${SKIP_BOOTSTRAP:-0}" == "1" ]] && [[ "${VERIFY_AFTER_DUMP_RESTORE:-0}" != "1" ]]; then
  if [[ "${SKIP_VERIFY+isset}" != "isset" ]]; then
    SKIP_VERIFY=1
    info "SKIP_BOOTSTRAP=1 — default SKIP_VERIFY=1 (dump path). VERIFY_AFTER_DUMP_RESTORE=1 to verify, or set SKIP_VERIFY=0 to force verify."
  fi
fi

# 5) Verify and schema report (optional)
if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  say "Step 5: Verify bootstrap and schema integrity report"
  PGPASSWORD=postgres ./scripts/verify-bootstrap.sh
  PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh
  ok "Verify and report done (see reports/schema-report-*.md)"
else
  info "SKIP_VERIFY=1: skipping verify-bootstrap and inspect-external-db-schemas"
fi

say "=== Done ==="
echo "Next: deploy (e.g. ./scripts/deploy-dev.sh), run tests, or load images into Colima k3s."
