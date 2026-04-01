#!/usr/bin/env bash
# Optional row-count sanity check after k6 messaging load (local dev).
# VERIFY_DB=1 ./scripts/verify-after-k6-messaging-db.sh
# Env: PGHOST PGPORT MESSAGING_DB PGUSER PGPASSWORD (defaults match OCH external layout)
set -euo pipefail

if [[ "${VERIFY_DB:-0}" != "1" ]]; then
  echo "Set VERIFY_DB=1 to run psql checks (skipped)."
  exit 0
fi

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5444}"
PGUSER="${PGUSER:-postgres}"
DB="${MESSAGING_DB:-messaging}"

echo "=== Messaging DB row counts ($PGHOST:$PGPORT/$DB) ==="
for q in \
  "SELECT 'messaging.messages', count(*)::text FROM messaging.messages" \
  "SELECT 'messages.messages', count(*)::text FROM messages.messages"; do
  if out=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -X -t -A -c "$q" 2>/dev/null); then
    echo "$out"
  else
    echo "(skip: $q — relation may not exist)"
  fi
done
