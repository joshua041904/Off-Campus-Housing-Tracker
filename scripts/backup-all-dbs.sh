#!/usr/bin/env bash
# Wrapper: backup all 7 housing Postgres DBs (ports 5441–5447).
# Delegates to backup-all-8-dbs.sh which backs up auth, listings, bookings, messaging, notification, trust, analytics.
#
# Usage: same as backup-all-8-dbs.sh
#   PGPASSWORD=postgres ./scripts/backup-all-dbs.sh
#   BACKUP_DIR=/path/to/backups ./scripts/backup-all-dbs.sh
#
# Output: backups/all-7-YYYYMMDD-HHMMSS/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/backup-all-8-dbs.sh" "$@"
