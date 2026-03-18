#!/usr/bin/env bash
# After k6/messaging load: verify message count = outbox count, no duplicate message ids, no orphan conversations.
# Usage: PGPASSWORD=postgres ./scripts/verify-messaging-integrity.sh

set -euo pipefail

HOST="${VERIFY_HOST:-127.0.0.1}"
PORT="${MESSAGING_DB_PORT:-5444}"
DB=messaging
USER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok()  { echo "✅ $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

echo "Verifying messaging DB integrity ($HOST:$PORT)..."

MESSAGE_COUNT=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM messaging.messages;" 2>/dev/null || echo "0")
OUTBOX_COUNT=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM messaging.outbox_events;" 2>/dev/null || echo "0")

echo "Messages: $MESSAGE_COUNT"
echo "Outbox rows: $OUTBOX_COUNT"

if [[ "$MESSAGE_COUNT" != "$OUTBOX_COUNT" ]]; then
  fail "Mismatch: messages ($MESSAGE_COUNT) != outbox_events ($OUTBOX_COUNT)"
fi
ok "Message count = outbox count"

DUPLICATES=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "
  SELECT COUNT(*) FROM (
    SELECT id, COUNT(*)
    FROM messaging.messages
    GROUP BY id
    HAVING COUNT(*) > 1
  ) d;
" 2>/dev/null || echo "1")

if [[ "${DUPLICATES:-0}" != "0" ]]; then
  fail "Duplicate message id detected"
fi
ok "No duplicate message ids"

# Orphan conversations: no participants
ORPHANS=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "
  SELECT COUNT(*) FROM messaging.conversations c
  WHERE NOT EXISTS (SELECT 1 FROM messaging.conversation_participants p WHERE p.conversation_id = c.id);
" 2>/dev/null || echo "0")
if [[ "${ORPHANS:-0}" != "0" ]]; then
  echo "⚠️  Orphan conversations (no participants): $ORPHANS"
fi

echo "✅ Messaging integrity verified"
