#!/usr/bin/env bash
# Apply every idempotent SQL migration in infra/db to all 8 housing Postgres DBs (5441–5448).
# Safe to re-run after restore from backups/all-8-* or cold bootstrap.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/apply-all-infra-db-migrations.sh
#   PGHOST=127.0.0.1 ./scripts/apply-all-infra-db-migrations.sh
#   BOOTSTRAP_ONLY=notification ./scripts/apply-all-infra-db-migrations.sh
#
# Optional post-steps (default on):
#   RUN_NOTIFICATION_ENRICH=1  — scripts/enrich-notification-booking-identities.sh
#   VERIFY_MIGRATION_COVERAGE=1 — fail if any infra/db/*.sql is not mapped below
#
# Does not run Prisma (auth/booking) — use restore-auth-db.sh and run-booking-migrations-k8s.sh for those.
# Account consolidation is separate: ./scripts/repair-tomwang-consolidation.sh [--apply]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL_DIR="$REPO_ROOT/infra/db"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

AUTH_DB_PORT="${AUTH_DB_PORT:-5441}"
LISTINGS_DB_PORT="${LISTINGS_DB_PORT:-5442}"
BOOKINGS_DB_PORT="${BOOKINGS_DB_PORT:-5443}"
MESSAGING_DB_PORT="${MESSAGING_DB_PORT:-5444}"
NOTIFICATION_DB_PORT="${NOTIFICATION_DB_PORT:-5445}"
TRUST_DB_PORT="${TRUST_DB_PORT:-5446}"
ANALYTICS_DB_PORT="${ANALYTICS_DB_PORT:-5447}"
MEDIA_DB_PORT="${MEDIA_DB_PORT:-5448}"

VERIFY_MIGRATION_COVERAGE="${VERIFY_MIGRATION_COVERAGE:-1}"
RUN_NOTIFICATION_ENRICH="${RUN_NOTIFICATION_ENRICH:-1}"

# All infra/db/*.sql files assigned to a DB (sorted). 00-create-listings-database.sql is manual/compose only.
declare -a AUTH_MIGRATIONS=(
  01-auth-outbox.sql
  02-auth-user-profile-fields.sql
  13-auth-username-citext-not-null.sql
  31-repair-consolidation-snapshot-schema.sql
)

declare -a LISTINGS_MIGRATIONS=(
  01-listings-schema-and-tuning.sql
  02-listings-pgbench-trigram-knn.sql
  03-listings-outbox.sql
  04-listings-processed-events.sql
  06-listings-active-created-at-index.sql
  07-community-posts.sql
  08-community-reports.sql
  09-listing-status-archived.sql
  10-community-post-flair.sql
  11-community-post-images.sql
  12-community-author-display.sql
  13-listings-geo-backfill.sql
  14-listings-display-location.sql
  16-community-post-votes-user-pk.sql
  17-listing-revisions.sql
  18-listing-revision-changes.sql
  18-listings-residence-address-structured.sql
  19-listings-pricing-hold.sql
)

declare -a BOOKINGS_MIGRATIONS=(
  01-booking-schema.sql
  02-booking-state-machine.sql
  03-booking-outbox.sql
  04-booking-search-history.sql
  05-booking-prisma-columns.sql
  06-booking-processed-events.sql
  19-booking-search-history-alerts.sql
  20-booking-tenant-username-snapshot.sql
)

declare -a MESSAGING_MIGRATIONS=(
  01-messaging-schema.sql
  02-messaging-outbox.sql
  03-messages-dm-schema.sql
  04-messaging-media-id.sql
  05-messaging-processed-events.sql
  05-messaging-rate-limit.sql
  06-messages-auth-username-mirror.sql
  15-messaging-external-contact-history.sql
  16-messaging-human-dm-thread-backfill.sql
  20-messaging-external-contact-delivery.sql
  21-messaging-message-reactions.sql
  22-messaging-message-deleted-edited.sql
  23-messaging-user-hidden-messages.sql
)

declare -a NOTIFICATION_MIGRATIONS=(
  01-notification-schema.sql
  02-notification-idempotency.sql
  03-notification-outbox.sql
  24-notification-read-state.sql
  25-notification-booking-context-read.sql
  26-notification-dedupe-key.sql
  27-notification-backfill-booking-context-read-and-dedupe.sql
  29-notification-booking-dedupe-cleanup.sql
  30-notification-booking-read-siblings.sql
  30-notification-booking-read-state-normalize.sql
)

declare -a TRUST_MIGRATIONS=(
  01-trust-schema.sql
  02-trust-scoring.sql
  03-trust-outbox.sql
  04-trust-processed-events.sql
  05-trust-spam-score.sql
  28-trust-flag-status-repair.sql
)

declare -a ANALYTICS_MIGRATIONS=(
  01-analytics-schema.sql
  02-analytics-projections.sql
  03-analytics-recommendation.sql
  04-analytics-user-listing-engagement.sql
  04-analytics-watchlist-engagement.sql
  07-analytics-pgvector-hybrid-search.sql
)

declare -a MEDIA_MIGRATIONS=(
  01-media-schema.sql
  02-media-outbox.sql
  03-media-inline-bytes.sql
  03-media-processed-events.sql
)

# Files intentionally not applied by this script (documented).
declare -a SKIPPED_MIGRATIONS=(
  00-create-listings-database.sql
)

verify_migration_coverage() {
  [[ "$VERIFY_MIGRATION_COVERAGE" == "1" ]] || return 0
  local -a mapped=()
  local f missing=0
  mapped+=("${AUTH_MIGRATIONS[@]}")
  mapped+=("${LISTINGS_MIGRATIONS[@]}")
  mapped+=("${BOOKINGS_MIGRATIONS[@]}")
  mapped+=("${MESSAGING_MIGRATIONS[@]}")
  mapped+=("${NOTIFICATION_MIGRATIONS[@]}")
  mapped+=("${TRUST_MIGRATIONS[@]}")
  mapped+=("${ANALYTICS_MIGRATIONS[@]}")
  mapped+=("${MEDIA_MIGRATIONS[@]}")
  mapped+=("${SKIPPED_MIGRATIONS[@]}")

  echo ""
  echo "Verifying infra/db migration coverage (${#mapped[@]} mapped files)…"
  for f in "$SQL_DIR"/*.sql; do
    [[ -f "$f" ]] || continue
    local base
    base="$(basename "$f")"
    local found=0
    for m in "${mapped[@]}"; do
      if [[ "$m" == "$base" ]]; then
        found=1
        break
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "  ❌ unmapped: $base (add to apply-all-infra-db-migrations.sh)"
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    echo "❌ Migration coverage check failed — update scripts/apply-all-infra-db-migrations.sh"
    exit 1
  fi
  echo "✅ All infra/db/*.sql files are mapped"
}

run_files() {
  local port="$1"
  local db="$2"
  shift 2
  local files=("$@")
  echo ""
  echo "━━━ $db (port $port) — ${#files[@]} migrations ━━━"
  if ! psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "❌ Cannot connect to $db at $PGHOST:$port — skip"
    return 1
  fi
  for f in "${files[@]}"; do
    [[ -f "$SQL_DIR/$f" ]] || { echo "  ⚠️  missing $f"; continue; }
    echo "  → $f"
    if [[ "$f" == "02-listings-pgbench-trigram-knn.sql" ]]; then
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -q -f "$SQL_DIR/$f" || true
    else
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -q -f "$SQL_DIR/$f"
    fi
  done
  echo "✅ $db migrations applied"
}

apply_auth() {
  run_files "$AUTH_DB_PORT" auth "${AUTH_MIGRATIONS[@]}"
}

apply_listings() {
  run_files "$LISTINGS_DB_PORT" listings "${LISTINGS_MIGRATIONS[@]}"
}

apply_bookings() {
  run_files "$BOOKINGS_DB_PORT" bookings "${BOOKINGS_MIGRATIONS[@]}"
}

apply_messaging() {
  run_files "$MESSAGING_DB_PORT" messaging "${MESSAGING_MIGRATIONS[@]}"
}

apply_notification() {
  run_files "$NOTIFICATION_DB_PORT" notification "${NOTIFICATION_MIGRATIONS[@]}"
}

apply_trust() {
  run_files "$TRUST_DB_PORT" trust "${TRUST_MIGRATIONS[@]}"
}

apply_analytics() {
  run_files "$ANALYTICS_DB_PORT" analytics "${ANALYTICS_MIGRATIONS[@]}"
}

apply_media() {
  run_files "$MEDIA_DB_PORT" media "${MEDIA_MIGRATIONS[@]}"
}

run_post_backfills() {
  echo ""
  echo "━━━ Post-migration backfills ━━━"
  if [[ "$RUN_NOTIFICATION_ENRICH" == "1" ]] && [[ -x "$SCRIPT_DIR/enrich-notification-booking-identities.sh" ]]; then
    echo "  → enrich-notification-booking-identities.sh"
    BOOKINGS_DB_PORT="$BOOKINGS_DB_PORT" NOTIFICATION_DB_PORT="$NOTIFICATION_DB_PORT" \
      "$SCRIPT_DIR/enrich-notification-booking-identities.sh" || {
      echo "  ⚠️  enrich-notification-booking-identities.sh failed (non-fatal)"
    }
  else
    echo "  (skip notification enrich — set RUN_NOTIFICATION_ENRICH=1 to enable)"
  fi
  echo "✅ Post backfills done"
}

only="${BOOTSTRAP_ONLY:-}"
verify_migration_coverage

if [[ -n "$only" ]]; then
  "apply_${only}" || { echo "Unknown BOOTSTRAP_ONLY=$only" >&2; exit 1; }
  if [[ "$only" == "notification" ]]; then
    run_post_backfills
  fi
  echo ""
  echo "Done (single DB: $only)."
  exit 0
fi

echo "Applying all infra/db migrations to $PGHOST (5441–5448)…"
apply_auth
apply_listings
apply_bookings
apply_messaging
apply_notification
apply_trust
apply_analytics
if [[ "${BOOTSTRAP_SKIP_MEDIA:-0}" != "1" ]]; then
  apply_media
fi
run_post_backfills
echo ""
echo "✅ All infra/db SQL migrations applied."
