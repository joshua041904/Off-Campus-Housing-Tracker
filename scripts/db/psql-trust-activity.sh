#!/usr/bin/env bash
# pg_stat_activity breakdown for the trust database (dbname is `trust`, not trust_db).
# Run during k6 trust load to spot active vs idle in transaction.
#
#   PGHOST=127.0.0.1 TRUST_DB_PORT=5446 ./scripts/db/psql-trust-activity.sh
#
set -euo pipefail
export PGPASSWORD="${PGPASSWORD:-postgres}"
psql -h "${PGHOST:-127.0.0.1}" -p "${TRUST_DB_PORT:-5446}" -U "${PGUSER:-postgres}" -d trust -c \
  "SELECT state, count(*) AS n
   FROM pg_stat_activity
   WHERE datname = current_database()
   GROUP BY 1
   ORDER BY n DESC;"
