#!/usr/bin/env bash
# Apply messaging schema to database 'messaging' on port 5444.
# Requires postgres-messaging up: docker compose up -d postgres-messaging
# Usage: PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-messaging-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5444}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to messaging at $PGHOST:$PGPORT. Start postgres-messaging." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL"
SQL3="$REPO_ROOT/infra/db/03-messages-dm-schema.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Messaging DM schema (03) applied."
fi
SQL2="$REPO_ROOT/infra/db/02-messaging-outbox.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Messaging outbox (02) applied."
fi
SQL4="$REPO_ROOT/infra/db/04-messaging-media-id.sql"
if [[ -f "$SQL4" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL4"
  echo "✅ Messaging media_id (04) applied."
fi
SQL5="$REPO_ROOT/infra/db/05-messaging-processed-events.sql"
if [[ -f "$SQL5" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL5"
  echo "✅ Messaging processed_events (05) applied."
fi
SQL16="$REPO_ROOT/infra/db/16-messaging-human-dm-thread-backfill.sql"
if [[ -f "$SQL16" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL16"
  echo "✅ Human DM thread_id backfill (16) applied."
fi
SQL15="$REPO_ROOT/infra/db/15-messaging-external-contact-history.sql"
if [[ -f "$SQL15" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL15"
  echo "✅ External contact history table (15) applied."
fi
SQL20="$REPO_ROOT/infra/db/20-messaging-external-contact-delivery.sql"
if [[ -f "$SQL20" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL20"
  echo "✅ External contact delivery columns (20) applied."
fi
for extra in \
  05-messaging-rate-limit.sql \
  06-messages-auth-username-mirror.sql \
  21-messaging-message-reactions.sql \
  22-messaging-message-deleted-edited.sql \
  23-messaging-user-hidden-messages.sql; do
  path="$REPO_ROOT/infra/db/$extra"
  if [[ -f "$path" ]]; then
    psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$path"
    echo "✅ Messaging $extra applied."
  fi
done
echo "✅ Messaging schema applied (port $PGPORT, database messaging)."
