#!/usr/bin/env bash
# Restore messaging DB from 5434-social dump into 5444/messaging (housing messaging service DB).
# After restore, optionally run ensure-messaging-schema.sh to add messaging.* schema (outbox, etc.) for tests.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore-messaging-db-from-social.sh
#   RESTORE_MESSAGING_DUMP=backups/5434-social.dump PGPASSWORD=postgres ./scripts/restore-messaging-db-from-social.sh
#
# Prereqs: Postgres messaging container up (e.g. docker compose up -d postgres-messaging), port 5444 reachable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${PGHOST:-127.0.0.1}"
PORT="${MESSAGING_DB_PORT:-5444}"
DB="messaging"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DUMP_PATH="${RESTORE_MESSAGING_DUMP:-$REPO_ROOT/backups/5434-social.dump}"
if [[ ! -f "$DUMP_PATH" ]]; then
  [[ -f "${DUMP_PATH}.gz" ]] && DUMP_PATH="${DUMP_PATH}.gz"
  [[ -f "${DUMP_PATH}.zip" ]] && DUMP_PATH="${DUMP_PATH}.zip"
fi

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "❌ No social dump found at $DUMP_PATH" >&2
  echo "Place 5434-social.dump (or .gz / .zip) in backups/ or set RESTORE_MESSAGING_DUMP=/path/to/dump" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "❌ pg_restore not found (e.g. brew install libpq)." >&2
  exit 1
fi

echo "🧨 Dropping and recreating messaging DB at $HOST:$PORT..."
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB;"
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;"

echo "📦 Restoring from 5434-social dump..."
if [[ "$DUMP_PATH" == *.gz ]]; then
  gunzip -c "$DUMP_PATH" | pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v 2>/dev/null || true
elif [[ "$DUMP_PATH" == *.zip ]]; then
  ( unzip -p "$DUMP_PATH" '*.dump' 2>/dev/null || unzip -p "$DUMP_PATH" ) | pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v 2>/dev/null || true
else
  pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --no-owner --no-privileges -v "$DUMP_PATH" 2>/dev/null || true
fi

echo "📊 Running ANALYZE..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE;"

echo "✅ Messaging DB restore complete (forum + messages schemas from 5434-social)."
echo "   Optional: run PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh to add messaging.* schema (outbox) for integration tests."
echo "   Verify: psql -h $HOST -p $PORT -U postgres -d $DB -c '\\dn'"
