#!/usr/bin/env bash
# Deterministic DB bootstrap: run SQL migrations in order for all 7 housing DBs (5441–5447).
# Prefer over dumps for team reproducibility. External Postgres must be up (e.g. bring-up-external-infra.sh).
#
# Order: auth → listings → bookings → messaging → notification → trust → analytics
# Usage: PGPASSWORD=postgres ./scripts/bootstrap-all-dbs.sh
# Optional: BOOTSTRAP_HOST=127.0.0.1 BOOTSTRAP_ONLY=messaging
#           DROP_IF_EXISTS=true — drop and recreate each DB before schema (deterministic, no leftover state)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL_DIR="$REPO_ROOT/infra/db"
cd "$REPO_ROOT"

PGHOST="${BOOTSTRAP_HOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DROP_IF_EXISTS="${DROP_IF_EXISTS:-false}"

run_psql() {
  local port=$1
  local db=$2
  shift 2
  local files=("$@")
  for f in "${files[@]}"; do
    [[ -f "$SQL_DIR/$f" ]] || continue
    echo "  → $f"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$SQL_DIR/$f" || exit 1
  done
}

drop_and_create_db() {
  local port=$1
  local db=$2
  echo "Drop and create DB $db on port $port..."
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
}

# 1) auth (5441) — outbox only; main schema from Prisma or restore-auth-db.sh
bootstrap_auth() {
  echo "Bootstrap auth (5441)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5441 auth
  run_psql 5441 auth 01-auth-outbox.sql
}

# 2) listings (5442)
bootstrap_listings() {
  echo "Bootstrap listings (5442)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5442 listings
  run_psql 5442 listings \
    00-create-listings-database.sql \
    01-listings-schema-and-tuning.sql \
    03-listings-outbox.sql \
    04-listings-processed-events.sql
}

# 3) bookings (5443)
bootstrap_bookings() {
  echo "Bootstrap bookings (5443)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5443 bookings
  run_psql 5443 bookings \
    01-booking-schema.sql \
    02-booking-state-machine.sql \
    03-booking-outbox.sql
}

# 4) messaging (5444)
bootstrap_messaging() {
  echo "Bootstrap messaging (5444)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5444 messaging
  run_psql 5444 messaging \
    01-messaging-schema.sql \
    02-messaging-outbox.sql \
    04-messaging-media-id.sql \
    05-messaging-rate-limit.sql
}

# 5) notification (5445)
bootstrap_notification() {
  echo "Bootstrap notification (5445)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5445 notification
  run_psql 5445 notification \
    01-notification-schema.sql \
    02-notification-idempotency.sql \
    03-notification-outbox.sql
}

# 6) trust (5446)
bootstrap_trust() {
  echo "Bootstrap trust (5446)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5446 trust
  run_psql 5446 trust \
    01-trust-schema.sql \
    02-trust-scoring.sql \
    03-trust-outbox.sql \
    04-trust-processed-events.sql \
    05-trust-spam-score.sql
}

# 7) analytics (5447)
bootstrap_analytics() {
  echo "Bootstrap analytics (5447)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db 5447 analytics
  run_psql 5447 analytics \
    01-analytics-schema.sql \
    02-analytics-projections.sql \
    03-analytics-recommendation.sql \
    04-analytics-user-listing-engagement.sql
}

only="${BOOTSTRAP_ONLY:-}"
if [[ -n "$only" ]]; then
  "bootstrap_$only" || { echo "Unknown BOOTSTRAP_ONLY=$only" >&2; exit 1; }
  echo "Done (single DB: $only)."
  exit 0
fi

bootstrap_auth
bootstrap_listings
bootstrap_bookings
bootstrap_messaging
bootstrap_notification
bootstrap_trust
bootstrap_analytics
echo "Done (all 7 DBs)."
