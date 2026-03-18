#!/usr/bin/env bash
# Apply booking schema to database 'bookings' on port 5443.
# Requires postgres-bookings up: docker compose up -d postgres-bookings
# Usage: PGPASSWORD=postgres ./scripts/ensure-booking-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-booking-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5443}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to bookings at $PGHOST:$PGPORT. Start postgres-bookings." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL"
echo "✅ Booking schema applied (port $PGPORT, database bookings)."
