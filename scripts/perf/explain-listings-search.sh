#!/usr/bin/env bash
# Run EXPLAIN (ANALYZE, BUFFERS, VERBOSE) for listings browse/search queries.
# Requires: Postgres listings DB (default 127.0.0.1:5442). Does NOT modify data.
#
# Usage:
#   ./scripts/perf/explain-listings-search.sh
#   PGHOST=127.0.0.1 PGPORT=5442 PGDATABASE=listings ./scripts/perf/explain-listings-search.sh
set -euo pipefail
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5442}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGHOST PGPORT PGUSER PGPASSWORD
PGDATABASE="${PGDATABASE:-listings}"

echo "=== EXPLAIN A: browse only (no q) ==="
psql -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<'SQL'
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active'
  AND (deleted_at IS NULL)
ORDER BY created_at DESC
LIMIT 50;
SQL

echo ""
echo "=== EXPLAIN B: ILIKE on title OR description (k6-style) ==="
psql -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<'SQL'
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active'
  AND (deleted_at IS NULL)
  AND (title ILIKE '%k6-1-0%' OR description ILIKE '%k6-1-0%')
ORDER BY created_at DESC
LIMIT 50;
SQL

echo ""
echo "Done. Paste both plans when reviewing tail latency."
