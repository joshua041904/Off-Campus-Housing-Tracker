#!/usr/bin/env bash
# PHASE 1 — Restore 5434 → 5444 (Messaging DB). Deterministic, zero-chaos.
# Usage: PGPASSWORD=postgres ./scripts/restore-5434-to-5444-messaging.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
HOST="${PGHOST:-127.0.0.1}"
PORT="5444"
DB="messaging"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "1️⃣ Drop and recreate messaging DB on port $PORT..."
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB;"
psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;"

echo "2️⃣ Restore extensions..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/backups/5434-social-extensions.sql"

echo "3️⃣ Restore dump..."
pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DB" --clean --if-exists --no-owner --no-privileges "$REPO_ROOT/backups/5434-social.dump" || true

echo "4️⃣ ANALYZE..."
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE;"
echo "✅ Phase 1 done: messaging DB on $HOST:$PORT"
