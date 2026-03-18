#!/usr/bin/env bash
# One-shot: bring up Colima cluster (MetalLB 251–260), external infra (8 Postgres, Kafka, Redis, MinIO), then compose + bootstrap.
# Use so no one gets lost — single entrypoint for "cluster + infra + DBs ready."
#
# Usage:
#   ./scripts/bring-up-cluster-and-infra.sh
#   RESTORE_BACKUP_DIR=latest ./scripts/bring-up-cluster-and-infra.sh
#   RESTORE_BACKUP_DIR=backups/all-8-20260318-174510 ./scripts/bring-up-cluster-and-infra.sh
#
# Env:
#   RESTORE_BACKUP_DIR   — set to "latest" (newest backups/all-8-* or all-7-*) or path (e.g. backups/all-8-20260318-174510); passed to bring-up-external-infra.sh which runs restore-external-postgres-from-backup.sh after Postgres is healthy. Omit to skip restore (bootstrap from SQL only).
#   SKIP_CLUSTER=1       — skip setup-new-colima-cluster.sh (e.g. Colima already up)
#   SKIP_COMPOSE=1       — skip docker compose up -d (e.g. already up)
#   SKIP_BOOTSTRAP=1     — skip bootstrap-after-bring-up.sh
#   SKIP_VERIFY=1        — skip verify-bootstrap.sh and inspect-external-db-schemas.sh
#
# Order: (1) setup-new-colima-cluster.sh, (2) bring-up-external-infra.sh, (3) docker compose up -d, (4) bootstrap-after-bring-up.sh, (5) verify-bootstrap + inspect (unless SKIP_VERIFY).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

say "=== Bring up cluster and external infra (single entrypoint) ==="
info "RESTORE_BACKUP_DIR=${RESTORE_BACKUP_DIR:-}(unset = bootstrap from SQL only; use 'latest' or path like backups/all-8-20260318-174510 to restore from backup)"

# 1) Colima + k3s + MetalLB (251–260)
if [[ "${SKIP_CLUSTER:-0}" != "1" ]]; then
  say "Step 1: Colima cluster (k3s + MetalLB pool 251–260)"
  ./scripts/setup-new-colima-cluster.sh
  ok "Cluster ready"
else
  info "SKIP_CLUSTER=1: skipping setup-new-colima-cluster.sh"
fi

# 2) External infra (Zookeeper, Kafka, Redis, MinIO, 8 Postgres); optional restore from backup
say "Step 2: External infra (Zookeeper, Kafka, Redis, MinIO, 8 Postgres)"
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

# 4) Bootstrap all 8 DBs from infra/db; restore auth from 5437-auth.dump if present
if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
  say "Step 4: Bootstrap DBs (and optional auth restore from backups/5437-auth.dump)"
  PGPASSWORD=postgres ./scripts/bootstrap-after-bring-up.sh
  ok "Bootstrap done"
else
  info "SKIP_BOOTSTRAP=1: skipping bootstrap-after-bring-up.sh"
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
