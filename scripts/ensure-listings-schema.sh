#!/usr/bin/env bash
# Apply listings schema and tuning (raw Postgres) to database 'listings' on port 5442.
# Safe to run multiple times. Requires postgres-listings up (docker compose up -d postgres-listings).
#
# Usage: PGPASSWORD=postgres ./scripts/ensure-listings-schema.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-listings-schema-and-tuning.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5442}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: SQL file not found: $SQL" >&2
  exit 1
fi

if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to listings DB at $PGHOST:$PGPORT. Start postgres-listings (e.g. docker compose up -d postgres-listings)." >&2
  exit 1
fi

psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -v ON_ERROR_STOP=1 -f "$SQL"

# Apply trigram/KNN search functions for pgbench (optional)
SQL2="$REPO_ROOT/infra/db/02-listings-pgbench-trigram-knn.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -v ON_ERROR_STOP=1 -f "$SQL2" >/dev/null 2>&1 || true
  echo "✅ Listings trigram/KNN (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-listings-outbox.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Listings outbox (03) applied."
fi
SQL4="$REPO_ROOT/infra/db/04-listings-processed-events.sql"
if [[ -f "$SQL4" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -v ON_ERROR_STOP=1 -f "$SQL4"
  echo "✅ Listings processed_events (04) applied."
fi
SQL6="$REPO_ROOT/infra/db/06-listings-active-created-at-index.sql"
if [[ -f "$SQL6" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d listings -v ON_ERROR_STOP=1 -f "$SQL6"
  echo "✅ Listings active+created_at index (06) applied."
fi
echo "✅ Listings schema and tuning applied (port $PGPORT, database listings)."
