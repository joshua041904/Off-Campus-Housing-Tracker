#!/usr/bin/env bash
# Apply 07b (resellable column) and 09-shopping-order-number-sequence.sql on shopping DB (port 5436).
# Fixes: (1) "column resellable of relation purchase_history does not exist", (2) "duplicate key orders_order_number_key".
# Safe to run multiple times. Called from preflight so baseline/shopping tests don't hit schema/sequence issues.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_07B="$REPO_ROOT/infra/db/07b-shopping-purchase-history-resellable.sql"
MIGRATION="$REPO_ROOT/infra/db/09-shopping-order-number-sequence.sql"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# 1. Add resellable to purchase_history if missing (fixes checkout/resell 500s when only 06 was applied).
if [[ -f "$MIGRATION_07B" ]]; then
  for db in shopping records postgres; do
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
      continue
    fi
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='shopping' AND table_name='purchase_history' LIMIT 1" 2>/dev/null | grep -q 1; then
      continue
    fi
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -f "$MIGRATION_07B" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
      ok "Shopping purchase_history.resellable (07b) ensured on port 5436, db $db"
    fi
  done
fi

if [[ ! -f "$MIGRATION" ]]; then
  warn "Shopping order-number sequence migration not found: $MIGRATION"
  exit 0
fi

# Port 5436: shopping service uses database "shopping" for shopping.orders (intended 8-DB layout; see infra/docs/EIGHT-DATABASES-ARCHITECTURE.md).
# We apply 09 to every DB on 5436 that has shopping.orders (shopping first, then records/postgres for backwards compatibility).
info "Port 5436: app uses database 'shopping' for shopping.orders. Applying sequence to DBs that have shopping.orders..."

# Shopping DB: port 5436. Primary DB is "shopping"; also apply to records/postgres if present (legacy).
# Schema "shopping" must exist (06/07). 09 creates shopping.order_number_seq and shopping.generate_order_number().
# IMPORTANT: Sync all DBs to the same global max so order_number never collides if app or scripts use more than one.
_applied=0
_global_max=0
for db in shopping records postgres; do
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    continue
  fi
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='shopping' AND table_name='orders' LIMIT 1" 2>/dev/null | grep -q 1; then
    if [[ "$db" == "shopping" ]]; then
      warn "5436/shopping: no shopping.orders table — run scripts/bootstrap-shopping-db-on-5436.sh or apply 06/07 to 5436/shopping"
    else
      info "5436/$db: no shopping.orders table; skip 09 (primary is 5436/shopping)"
    fi
    continue
  fi
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -f "$MIGRATION" 2>/dev/null; then
    warn "Shopping order_number sequence on 5436/$db had issues (may be no-op or already applied)"
    continue
  fi
  ok "Shopping order_number sequence (09) applied on port 5436, db $db"
  _applied=$((_applied + 1))
  # Compute this DB's max numeric part; keep global max across all DBs so we setval to same value everywhere (avoids duplicate when app uses different DBs).
  _db_max=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "
    SELECT COALESCE(GREATEST(
      (SELECT MAX(CAST(SUBSTRING(order_number FROM 'ORD-[0-9]{4}-([0-9]+)') AS BIGINT)) FROM shopping.orders WHERE order_number ~ '^ORD-[0-9]{4}-[0-9]+\$'),
      (SELECT COALESCE(last_value, 0) FROM shopping.order_number_seq)
    ), 0)
  " 2>/dev/null | tr -d ' \n' || echo "0")
  [[ "${_db_max:-0}" -gt "${_global_max:-0}" ]] && _global_max="$_db_max"
done
# Use separate sequence ranges per DB so if the app ever uses more than one DB we never get duplicate order_number.
# shopping (primary) and records: nextval = global_max + 5001, ...; postgres: nextval = global_max + 1005001, ... (offset 1e6).
SHOPPING_SEQ_OFFSET=1000000
_setval_records=$((_global_max + 5000))
_setval_postgres=$((_global_max + 5000 + SHOPPING_SEQ_OFFSET))
for db in shopping records postgres; do
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='shopping' AND table_name='orders' LIMIT 1" 2>/dev/null | grep -q 1; then
    continue
  fi
  if [[ "$db" == "postgres" ]]; then
    _setval_target="$_setval_postgres"
  else
    _setval_target="$_setval_records"
  fi
  # Never decrease sequence (avoids duplicate key when migration/ensure run in parallel or after restore).
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT setval('shopping.order_number_seq', GREATEST(COALESCE((SELECT last_value FROM pg_sequences WHERE schemaname = 'shopping' AND sequencename = 'order_number_seq'), 0)::bigint, $_setval_target));" >/dev/null 2>&1 || true
  has_seq=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM pg_sequences WHERE schemaname='shopping' AND sequencename='order_number_seq'" 2>/dev/null || echo "0")
  has_fn=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='shopping' AND p.proname='generate_order_number'" 2>/dev/null || echo "0")
  if [[ "${has_seq:-0}" == "1" ]] && [[ "${has_fn:-0}" == "1" ]]; then
    ok "Verified: sequence and generate_order_number() present (synced to $_setval_target, range for $db) on $db"
  else
    warn "Sequence or function check failed on $db (seq=$has_seq fn=$has_fn)"
  fi
done
if [[ "${_applied:-0}" -gt 0 ]]; then
  info "5436 summary: shopping.orders lives in db 'shopping' (primary); sequence applied. Legacy 5436/records and 5436/postgres also synced if present."
  exit 0
fi
warn "Shopping DB (5436) not reachable or no DB had shopping.orders; app expects 5436/shopping. Run scripts/bootstrap-shopping-db-on-5436.sh when Postgres is up."
exit 0
