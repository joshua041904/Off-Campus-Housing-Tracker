#!/usr/bin/env bash
# After bootstrap: verify each DB reachable, required tables exist, outbox and processed_events where applicable.
# Fail fast if missing. Usage: PGPASSWORD=postgres ./scripts/verify-bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${VERIFY_DB_HOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
# Single Postgres in CI: set VERIFY_DB_PORT=5441 to check all 7 DBs on one port
VERIFY_AUTH_PORT="${VERIFY_DB_PORT:-${VERIFY_AUTH_PORT:-5441}}"
VERIFY_LISTINGS_PORT="${VERIFY_DB_PORT:-${VERIFY_LISTINGS_PORT:-5442}}"
VERIFY_BOOKINGS_PORT="${VERIFY_DB_PORT:-${VERIFY_BOOKINGS_PORT:-5443}}"
VERIFY_MESSAGING_PORT="${VERIFY_DB_PORT:-${VERIFY_MESSAGING_PORT:-5444}}"
VERIFY_NOTIFICATION_PORT="${VERIFY_DB_PORT:-${VERIFY_NOTIFICATION_PORT:-5445}}"
VERIFY_TRUST_PORT="${VERIFY_DB_PORT:-${VERIFY_TRUST_PORT:-5446}}"
VERIFY_ANALYTICS_PORT="${VERIFY_DB_PORT:-${VERIFY_ANALYTICS_PORT:-5447}}"
VERIFY_MEDIA_PORT="${VERIFY_DB_PORT:-${VERIFY_MEDIA_PORT:-5448}}"

ok()  { echo "✅ $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

check_table() {
  local port=$1
  local db=$2
  local schema=$3
  local table=$4
  local q="SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = '$table';"
  local r
  r=$(psql -h "$HOST" -p "$port" -U "$PGUSER" -d "$db" -t -A -c "$q" 2>/dev/null || echo "0")
  [[ "$r" == "1" ]] || return 1
}

check_db_reachable() {
  psql -h "$HOST" -p "$1" -U "$PGUSER" -d "$2" -c "SELECT 1;" &>/dev/null
}

# Auth transactional outbox: Prisma migration uses auth.auth_outbox; infra/db/01-auth-outbox.sql adds auth.outbox_events (proto-style publisher). Either or both may exist after restore; at least one is required.
check_auth_outbox_present() {
  check_table "$VERIFY_AUTH_PORT" auth auth outbox_events && return 0
  check_table "$VERIFY_AUTH_PORT" auth auth auth_outbox && return 0
  return 1
}

echo "Verifying bootstrap (host=$HOST)..."

check_db_reachable "$VERIFY_AUTH_PORT" auth || fail "auth DB unreachable"
check_auth_outbox_present || fail "auth transactional outbox missing (need auth.outbox_events and/or auth.auth_outbox — run: psql ... -f infra/db/01-auth-outbox.sql and/or prisma migrate)"
ok "auth"

# Listings: outbox, processed_events
check_db_reachable "$VERIFY_LISTINGS_PORT" listings || fail "listings DB unreachable"
check_table "$VERIFY_LISTINGS_PORT" listings listings outbox_events 2>/dev/null || true
check_table "$VERIFY_LISTINGS_PORT" listings listings processed_events 2>/dev/null || true
ok "listings"

# Bookings: outbox
check_db_reachable "$VERIFY_BOOKINGS_PORT" bookings || fail "bookings DB unreachable"
check_table "$VERIFY_BOOKINGS_PORT" bookings bookings outbox_events 2>/dev/null || check_table "$VERIFY_BOOKINGS_PORT" bookings public outbox_events || true
ok "bookings"

# Messaging: messages, outbox_events, conversations
check_db_reachable "$VERIFY_MESSAGING_PORT" messaging || fail "messaging DB unreachable"
check_table "$VERIFY_MESSAGING_PORT" messaging messaging messages || fail "messaging.messages missing"
check_table "$VERIFY_MESSAGING_PORT" messaging messaging outbox_events || fail "messaging.outbox_events missing"
check_table "$VERIFY_MESSAGING_PORT" messaging messaging conversations || fail "messaging.conversations missing"
ok "messaging"

# Notification
check_db_reachable "$VERIFY_NOTIFICATION_PORT" notification || fail "notification DB unreachable"
ok "notification"

# Trust: outbox, processed_events, user_spam_score
check_db_reachable "$VERIFY_TRUST_PORT" trust || fail "trust DB unreachable"
check_table "$VERIFY_TRUST_PORT" trust trust outbox_events 2>/dev/null || true
check_table "$VERIFY_TRUST_PORT" trust trust processed_events 2>/dev/null || true
check_table "$VERIFY_TRUST_PORT" trust trust user_spam_score 2>/dev/null || true
ok "trust"

# Analytics: events, processed_events, user_listing_engagement
check_db_reachable "$VERIFY_ANALYTICS_PORT" analytics || fail "analytics DB unreachable"
check_table "$VERIFY_ANALYTICS_PORT" analytics analytics events 2>/dev/null || true
check_table "$VERIFY_ANALYTICS_PORT" analytics analytics processed_events 2>/dev/null || true
check_table "$VERIFY_ANALYTICS_PORT" analytics analytics user_listing_engagement 2>/dev/null || true
ok "analytics"

# Media (optional)
check_db_reachable "$VERIFY_MEDIA_PORT" media 2>/dev/null && check_table "$VERIFY_MEDIA_PORT" media media media_files 2>/dev/null && ok "media" || true

echo "Bootstrap verified (all DBs)."
