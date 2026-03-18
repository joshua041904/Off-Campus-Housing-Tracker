#!/usr/bin/env bash
# Restore auth DB from dump (dump-first), then apply outbox migration. Authoritative for auth when dump exists.
# Use after starting postgres-auth (e.g. docker compose up -d). No bootstrap of auth when using this.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore-auth-db.sh
#   RESTORE_AUTH_DUMP=backups/5437-auth.dump.gz PGPASSWORD=postgres ./scripts/restore-auth-db.sh
#
# Prereqs: Postgres auth container up, port 5441 reachable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${RESTORE_HOST:-${PGHOST:-127.0.0.1}}"
PORT="${RESTORE_PORT:-${PGPORT:-5441}}"
DB="${PGDB:-auth}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DUMP_PATH="${RESTORE_AUTH_DUMP:-$REPO_ROOT/backups/5437-auth.dump}"
if [[ ! -f "$DUMP_PATH" ]]; then
  [[ -f "${DUMP_PATH}.gz" ]] && DUMP_PATH="${DUMP_PATH}.gz"
  [[ -f "${DUMP_PATH}.zip" ]] && DUMP_PATH="${DUMP_PATH}.zip"
fi

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "❌ No auth dump found at $DUMP_PATH" >&2
  echo "Place 5437-auth.dump (or .gz / .zip) in backups/ or set RESTORE_AUTH_DUMP=/path/to/dump" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "❌ pg_restore not found (e.g. brew install libpq)." >&2
  exit 1
fi

echo "🧨 Dropping and recreating auth DB..."
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB;"
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;"

echo "📦 Restoring auth dump..."
if [[ "$DUMP_PATH" == *.gz ]]; then
  gunzip -c "$DUMP_PATH" | pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v 2>/dev/null || true
elif [[ "$DUMP_PATH" == *.zip ]]; then
  ( unzip -p "$DUMP_PATH" '*.dump' 2>/dev/null || unzip -p "$DUMP_PATH" ) | pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v 2>/dev/null || true
else
  pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v "$DUMP_PATH" 2>/dev/null || true
fi

echo "➕ Applying outbox migration..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/infra/db/01-auth-outbox.sql"

echo "📊 Running ANALYZE..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE;"

echo "✅ Auth restore complete. Verify: psql -h $HOST -p $PORT -U postgres -d $DB -c '\\dt auth.*'"
