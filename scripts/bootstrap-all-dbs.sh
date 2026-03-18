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
# Single Postgres in CI: set all *_DB_PORT=5441 (or CI_POSTGRES_PORT) to use one instance for all 7 DBs
AUTH_DB_PORT="${AUTH_DB_PORT:-5441}"
LISTINGS_DB_PORT="${LISTINGS_DB_PORT:-5442}"
BOOKINGS_DB_PORT="${BOOKINGS_DB_PORT:-5443}"
MESSAGING_DB_PORT="${MESSAGING_DB_PORT:-5444}"
NOTIFICATION_DB_PORT="${NOTIFICATION_DB_PORT:-5445}"
TRUST_DB_PORT="${TRUST_DB_PORT:-5446}"
ANALYTICS_DB_PORT="${ANALYTICS_DB_PORT:-5447}"
MEDIA_DB_PORT="${MEDIA_DB_PORT:-5448}"

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

# 1) auth — outbox only; main schema from Prisma or restore-auth-db.sh
bootstrap_auth() {
  echo "Bootstrap auth (port $AUTH_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$AUTH_DB_PORT" auth
  run_psql "$AUTH_DB_PORT" auth 01-auth-outbox.sql
}

# 2) listings
bootstrap_listings() {
  echo "Bootstrap listings (port $LISTINGS_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$LISTINGS_DB_PORT" listings
  run_psql "$LISTINGS_DB_PORT" listings \
    00-create-listings-database.sql \
    01-listings-schema-and-tuning.sql \
    03-listings-outbox.sql \
    04-listings-processed-events.sql
}

# 3) bookings
bootstrap_bookings() {
  echo "Bootstrap bookings (port $BOOKINGS_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$BOOKINGS_DB_PORT" bookings
  run_psql "$BOOKINGS_DB_PORT" bookings \
    01-booking-schema.sql \
    02-booking-state-machine.sql \
    03-booking-outbox.sql
}

# 4) messaging
bootstrap_messaging() {
  echo "Bootstrap messaging (port $MESSAGING_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$MESSAGING_DB_PORT" messaging
  run_psql "$MESSAGING_DB_PORT" messaging \
    01-messaging-schema.sql \
    02-messaging-outbox.sql \
    04-messaging-media-id.sql \
    05-messaging-rate-limit.sql
}

# 5) notification
bootstrap_notification() {
  echo "Bootstrap notification (port $NOTIFICATION_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$NOTIFICATION_DB_PORT" notification
  run_psql "$NOTIFICATION_DB_PORT" notification \
    01-notification-schema.sql \
    02-notification-idempotency.sql \
    03-notification-outbox.sql
}

# 6) trust
bootstrap_trust() {
  echo "Bootstrap trust (port $TRUST_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$TRUST_DB_PORT" trust
  run_psql "$TRUST_DB_PORT" trust \
    01-trust-schema.sql \
    02-trust-scoring.sql \
    03-trust-outbox.sql \
    04-trust-processed-events.sql \
    05-trust-spam-score.sql
}

# 7) analytics
bootstrap_analytics() {
  echo "Bootstrap analytics (port $ANALYTICS_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$ANALYTICS_DB_PORT" analytics
  run_psql "$ANALYTICS_DB_PORT" analytics \
    01-analytics-schema.sql \
    02-analytics-projections.sql \
    03-analytics-recommendation.sql \
    04-analytics-user-listing-engagement.sql
}

# 8) media (optional; used by media-service integration tests)
bootstrap_media() {
  echo "Bootstrap media (port $MEDIA_DB_PORT)..."
  [[ "$DROP_IF_EXISTS" == "true" ]] && drop_and_create_db "$MEDIA_DB_PORT" media
  run_psql "$MEDIA_DB_PORT" media \
    01-media-schema.sql \
    02-media-outbox.sql
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
if [[ "${BOOTSTRAP_SKIP_MEDIA:-0}" != "1" ]]; then
  bootstrap_media
fi
echo "Done (all DBs)."
