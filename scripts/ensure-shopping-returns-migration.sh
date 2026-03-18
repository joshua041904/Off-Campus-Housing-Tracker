#!/usr/bin/env bash
# Apply 22-shopping-returns.sql on shopping DB (port 5436).
# Fixes Test 13g: "Request return returned HTTP 404" — returns table must exist for POST /returns.
# Safe to run multiple times (CREATE TABLE IF NOT EXISTS). Run alongside ensure-shopping-order-number-sequence.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION="$REPO_ROOT/infra/db/22-shopping-returns.sql"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

if [[ ! -f "$MIGRATION" ]]; then
  warn "Shopping returns migration not found: $MIGRATION"
  exit 0
fi

# Port 5436: shopping.returns depends on shopping.orders, shopping.purchase_history, shopping.update_updated_at() (06/07).
# Apply to every DB on 5436 that has shopping.orders and shopping.purchase_history.
info "Port 5436: applying shopping.returns (22) to DBs with shopping.orders and shopping.purchase_history..."

_applied=0
for db in shopping records postgres; do
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    continue
  fi
  has_orders=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='shopping' AND table_name='orders' LIMIT 1" 2>/dev/null | tr -d ' \n' || echo "0")
  has_ph=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='shopping' AND table_name='purchase_history' LIMIT 1" 2>/dev/null | tr -d ' \n' || echo "0")
  if [[ "${has_orders:-0}" != "1" ]] || [[ "${has_ph:-0}" != "1" ]]; then
    if [[ "$db" == "shopping" ]]; then
      warn "5436/shopping: missing shopping.orders or shopping.purchase_history — run bootstrap or apply 06/07 first"
    fi
    continue
  fi
  if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5436 -U postgres -d "$db" -f "$MIGRATION" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
    ok "Shopping returns (22) ensured on port 5436, db $db"
    _applied=$((_applied + 1))
  else
    warn "Shopping returns on 5436/$db had issues (may be no-op or already applied)"
  fi
done

if [[ "${_applied:-0}" -gt 0 ]]; then
  info "5436 summary: shopping.returns table ensured. Test 13g (Request Return) needs this."
  exit 0
fi
warn "No DB on 5436 had shopping.orders+purchase_history; returns not applied. Run bootstrap or ensure-shopping-order-number-sequence first."
exit 0
