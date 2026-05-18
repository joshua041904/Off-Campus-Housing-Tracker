#!/usr/bin/env bash
# Apply idempotent community SQL to the listings database (local / Metal / any psql-reachable URL).
# Env: LISTINGS_DB_URL or POSTGRES_URL_LISTINGS (default docker-compose listings port).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL_DIR="$REPO_ROOT/infra/db"

LISTINGS_DB_URL="${LISTINGS_DB_URL:-${POSTGRES_URL_LISTINGS:-postgresql://postgres:postgres@127.0.0.1:5442/listings}}"

for f in 07-community-posts.sql 08-community-reports.sql 09-listing-status-archived.sql 10-community-post-flair.sql 11-community-post-images.sql 12-community-author-display.sql 13-listings-geo-backfill.sql 14-listings-display-location.sql 16-community-post-votes-user-pk.sql 17-listing-revisions.sql 18-listing-revision-changes.sql 19-listings-pricing-hold.sql; do
  echo "→ $f"
  psql "$LISTINGS_DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/$f"
done

echo "✅ Listings community schema + geo backfill ensured (07-19)"
