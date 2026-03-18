#!/usr/bin/env bash
# Wrapper: backup all 8 housing Postgres DBs (5441–5448).
# Delegates to backup-all-8-dbs.sh (auth, listings, bookings, messaging, notification, trust, analytics, media).
#
# Usage: same as backup-all-8-dbs.sh
#   PGPASSWORD=postgres ./scripts/backup-all-dbs.sh
#   BACKUP_DIR=/path/to/backups ./scripts/backup-all-dbs.sh
#
# Output: backups/all-8-YYYYMMDD-HHMMSS/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/backup-all-8-dbs.sh" "$@"
