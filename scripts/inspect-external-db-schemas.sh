#!/usr/bin/env bash
# Inspect external Postgres DBs (5441–5448), write schema report to MD, and compare actual vs expected (from infra/db and auth dump).
# Usage: ./scripts/inspect-external-db-schemas.sh [report-dir]
#   report-dir defaults to reports/; report: report-dir/schema-report-<timestamp>.md
# Env: PGHOST (default 127.0.0.1), PGPASSWORD (default postgres). INSPECT_DBS overrides default 8-DB layout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

REPORT_BASE="${1:-reports}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$REPORT_BASE/schema-report-$TIMESTAMP.md"
mkdir -p "$REPORT_BASE"

# Default: housing 8 DBs (ports 5441–5448). Format: port:dbname:label
if [[ -z "${INSPECT_DBS:-}" ]]; then
  INSPECT_DBS="5441:auth:auth
5442:listings:listings
5443:bookings:bookings
5444:messaging:messaging
5445:notification:notification
5446:trust:trust
5447:analytics:analytics
5448:media:media"
fi
if [[ -f "${INSPECT_DBS:-}" ]]; then
  DB_LIST="$(cat "$INSPECT_DBS")"
else
  DB_LIST="$INSPECT_DBS"
fi

# Expected tables per DB (schema.table) from infra/db SQL and auth dump. Used for integrity comparison.
# auth: dump + 01-auth-outbox.sql
expect_5441="auth.outbox_events auth.users auth.sessions auth.mfa_settings auth.oauth_providers auth.passkeys auth.passkey_challenges auth.verification_codes auth.user_addresses"
# listings: 00-create-listings-database.sql, 01-listings-schema-and-tuning.sql, 03-listings-outbox.sql, 04-listings-processed-events.sql
expect_5442="listings.listings listings.outbox_events listings.processed_events"
# bookings: 01-booking-schema.sql, 02-booking-state-machine.sql, 03-booking-outbox.sql
expect_5443="booking.bookings booking.outbox_events"
# messaging: 01-messaging-schema.sql, 02-messaging-outbox.sql, ...
expect_5444="messaging.conversations messaging.messages messaging.outbox_events"
# notification: 01-notification-schema.sql, 02-notification-idempotency.sql, 03-notification-outbox.sql
expect_5445="notification.user_preferences notification.outbox_events"
# trust: 01-trust-schema.sql, 02-trust-scoring.sql, 03-trust-outbox.sql, 04-trust-processed-events.sql, 05-trust-spam-score.sql
expect_5446="trust.outbox_events trust.processed_events trust.reputation trust.user_spam_score"
# analytics: 01-analytics-schema.sql, 02-analytics-projections.sql, ...
expect_5447="analytics.events analytics.processed_events analytics.daily_metrics"
# media: 01-media-schema.sql, 02-media-outbox.sql
expect_5448="media.media_files media.outbox_events"

echo "=== Inspect external DB schemas (5441–5448) ==="
echo "Report: $REPORT_FILE"
echo ""

{
  echo "# External DB schema report — $TIMESTAMP"
  echo ""
  echo "Generated: $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
  echo ""
  echo "Host: \`$PGHOST\` (user: $PGUSER). Ports: 5441 (auth) … 5448 (media)."
  echo ""
  echo "---"
  echo ""
} > "$REPORT_FILE"

all_match=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"

  echo "## Port $port — $label (\`$dbname\`)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  # Actual: list schema.table for user tables
  actual_tables=""
  actual_output=""
  if actual_output=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A -P pager=off -c "
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname;
  " 2>/dev/null); then
    actual_tables=$(echo "$actual_output" | tr '\n' ' ')
    echo "### Actual tables (from DB)" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -P pager=off -c "
      SELECT n.nspname AS schema, c.relname AS table_name, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname;
    " 2>/dev/null >> "$REPORT_FILE" || true
    echo "" >> "$REPORT_FILE"
  else
    echo "*(connection or query failed)*" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "  Inspected $port $dbname — FAILED"
    all_match=1
    continue
  fi

  # Expected (from infra/db and auth dump)
  expected_var="expect_${port}"
  expected_tables="${!expected_var:-}"
  echo "### Expected tables (from infra/db and auth dump)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "| schema.table |" >> "$REPORT_FILE"
  echo "|--------------|" >> "$REPORT_FILE"
  for t in $expected_tables; do echo "| \`$t\` |" >> "$REPORT_FILE"; done
  echo "" >> "$REPORT_FILE"

  # Comparison
  echo "### Integrity check" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  missing=""
  for t in $expected_tables; do
    if echo " $actual_tables " | grep -qF " $t "; then
      : # present
    else
      missing="$missing $t"
    fi
  done
  if [[ -z "$missing" ]]; then
    echo "✅ **Match** — All expected tables present." >> "$REPORT_FILE"
    echo "  Inspected $port $dbname ($label) — OK"
  else
    echo "❌ **Mismatch** — Missing: \`${missing# }\`" >> "$REPORT_FILE"
    echo "  Inspected $port $dbname ($label) — MISMATCH"
    all_match=1
  fi
  echo "" >> "$REPORT_FILE"
done <<< "$DB_LIST"

# Summary
{
  echo "---"
  echo ""
  echo "## Data integrity summary"
  echo ""
  if [[ $all_match -eq 0 ]]; then
    echo "✅ All DBs match expected schema (from infra/db and auth dump). Safe to run tests."
  else
    echo "❌ One or more DBs are missing expected tables. Fix bootstrap/restore before running tests."
  fi
  echo ""
} >> "$REPORT_FILE"

echo ""
echo "Report: $REPORT_FILE"
exit $all_match
