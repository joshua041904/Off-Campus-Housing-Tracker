#!/usr/bin/env bash
# PHASE 2 — Restore 5437 → 5441 (Auth DB). Deterministic, zero-chaos.
# Usage: PGPASSWORD=postgres ./scripts/restore-5437-to-5441-auth.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
HOST="${PGHOST:-127.0.0.1}"
PORT="5441"
DB="auth"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# Prefer 5437-auth.dump; fallback to "5437-auth copy.dump"
DUMP="$REPO_ROOT/backups/5437-auth.dump"
[[ ! -f "$DUMP" ]] && DUMP="$REPO_ROOT/backups/5437-auth copy.dump"
if [[ ! -f "$DUMP" ]]; then
  echo "❌ No 5437-auth dump found in backups/" >&2
  exit 1
fi

echo "1️⃣ Drop and recreate auth DB on port $PORT..."
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB;"
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;"

echo "2️⃣ Restore extensions..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/backups/5437-auth-extensions.sql"

echo "3️⃣ Restore dump..."
pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --clean --if-exists --no-owner --no-privileges "$DUMP" || true

echo "4️⃣ ANALYZE..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE;"
echo "✅ Phase 2 done: auth DB on $HOST:$PORT"
