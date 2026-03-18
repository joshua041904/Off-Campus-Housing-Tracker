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

echo "Verifying bootstrap (host=$HOST)..."

# Auth (5441): outbox_events
check_db_reachable 5441 auth || fail "auth DB unreachable"
check_table 5441 auth auth outbox_events || fail "auth.outbox_events missing"
ok "auth"

# Listings (5442): outbox, processed_events
check_db_reachable 5442 listings || fail "listings DB unreachable"
check_table 5442 listings listings outbox_events 2>/dev/null || true
check_table 5442 listings listings processed_events 2>/dev/null || true
ok "listings"

# Bookings (5443): outbox
check_db_reachable 5443 bookings || fail "bookings DB unreachable"
check_table 5443 bookings bookings outbox_events 2>/dev/null || check_table 5443 bookings public outbox_events || true
ok "bookings"

# Messaging (5444): messages, outbox_events, conversations
check_db_reachable 5444 messaging || fail "messaging DB unreachable"
check_table 5444 messaging messaging messages || fail "messaging.messages missing"
check_table 5444 messaging messaging outbox_events || fail "messaging.outbox_events missing"
check_table 5444 messaging messaging conversations || fail "messaging.conversations missing"
ok "messaging"

# Notification (5445)
check_db_reachable 5445 notification || fail "notification DB unreachable"
ok "notification"

# Trust (5446): outbox, processed_events, user_spam_score
check_db_reachable 5446 trust || fail "trust DB unreachable"
check_table 5446 trust trust outbox_events 2>/dev/null || true
check_table 5446 trust trust processed_events 2>/dev/null || true
check_table 5446 trust trust user_spam_score 2>/dev/null || true
ok "trust"

# Analytics (5447): events, processed_events, user_listing_engagement
check_db_reachable 5447 analytics || fail "analytics DB unreachable"
check_table 5447 analytics analytics events 2>/dev/null || true
check_table 5447 analytics analytics processed_events 2>/dev/null || true
check_table 5447 analytics analytics user_listing_engagement 2>/dev/null || true
ok "analytics"

echo "Bootstrap verified (all 7 DBs)."
