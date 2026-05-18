#!/usr/bin/env bash
# Fail when notification DB references bookings but bookings DB has no rows (restore regression).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

psql_q() {
  psql -h "$PGHOST" -p "$1" -U postgres -d "$2" -tA -v ON_ERROR_STOP=1 -c "$3"
}

booking_count="$(psql_q 5443 bookings "SELECT count(*) FROM booking.bookings" 2>/dev/null || echo "0")"
notif_booking_count="$(psql_q 5445 notification "SELECT count(*) FROM notification.notifications WHERE event_type ILIKE 'booking.%'" 2>/dev/null || echo "0")"
watchlist_count="$(psql_q 5443 bookings "SELECT count(*) FROM booking.watchlist_items WHERE is_active = true" 2>/dev/null || echo "0")"

echo "bookings.bookings rows: $booking_count"
echo "notification booking.* rows: $notif_booking_count"
echo "active watchlist rows: $watchlist_count"

if [[ "$notif_booking_count" -gt 0 && "$booking_count" -eq 0 ]]; then
  fail "Data regression: notification has booking events but booking.bookings is empty. Re-run restore:
  kubectl scale deployment/booking-service -n off-campus-housing-tracker --replicas=0 2>/dev/null || true
  PGPASSWORD=postgres ./scripts/restore-external-postgres-from-backup.sh backups/all-8-<stamp>
  PGPASSWORD=postgres BOOTSTRAP_ONLY=bookings ./scripts/apply-all-infra-db-migrations.sh"
fi

if [[ "$booking_count" -gt 0 ]]; then
  tomwang="$(psql_q 5443 bookings "SELECT count(*) FROM booking.bookings WHERE tenant_username_snapshot ILIKE '%tomwang%'" 2>/dev/null || echo "0")"
  echo "bookings with tomwang snapshot: $tomwang"
fi

ok "restore data check passed"
