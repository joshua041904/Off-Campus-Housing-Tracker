#!/usr/bin/env bash
# Apply media schema to database 'media' on port 5448.
# Optional: add postgres-media to docker-compose (port 5448) or create DB manually.
# Usage: PGPASSWORD=postgres ./scripts/ensure-media-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-media-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5448}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d media -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to media at $PGHOST:$PGPORT. Create DB 'media' and ensure Postgres is listening (e.g. add postgres-media to docker-compose)." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d media -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-media-outbox.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d media -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Media outbox (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-media-processed-events.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d media -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Media processed_events (03) applied."
fi
echo "✅ Media schema applied (port $PGPORT, database media)."
