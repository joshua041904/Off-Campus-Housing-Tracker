#!/usr/bin/env bash
# Inspect auth.auth_outbox: unpublished rows, retry_count, grouped by topic.
# Requires: psql and POSTGRES_URL_AUTH (or pass URL as first argument).
#
# Usage:
#   POSTGRES_URL_AUTH='postgresql://.../auth' ./scripts/auth-outbox-inspect.sh
#   ./scripts/auth-outbox-inspect.sh 'postgresql://.../auth'
set -euo pipefail

URL="${1:-${POSTGRES_URL_AUTH:-}}"
if [[ -z "$URL" ]]; then
  echo "Usage: POSTGRES_URL_AUTH=... $0   OR   $0 'postgresql://.../auth'" >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || { echo "psql required" >&2; exit 1; }

echo "=== auth.auth_outbox — summary by topic (unpublished vs published) ==="
psql "$URL" -v ON_ERROR_STOP=1 -c "
SELECT topic,
       COUNT(*) FILTER (WHERE published_at IS NULL) AS unpublished,
       COUNT(*) FILTER (WHERE published_at IS NOT NULL) AS published,
       COALESCE(MAX(retry_count) FILTER (WHERE published_at IS NULL), 0) AS max_retry_unpublished
FROM auth.auth_outbox
GROUP BY topic
ORDER BY topic;
"

echo ""
echo "=== Oldest unpublished rows (limit 30) ==="
psql "$URL" -v ON_ERROR_STOP=1 -c "
SELECT id::text, topic, event_type, aggregate_id, retry_count, created_at
FROM auth.auth_outbox
WHERE published_at IS NULL
ORDER BY created_at ASC
LIMIT 30;
"
