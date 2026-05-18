#!/usr/bin/env bash
# Run community SQL inside listings-service pod (requires postgresql-client + SQL files in image).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NAMESPACE="${K8S_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"
DEPLOY="${LISTINGS_DEPLOYMENT:-deployment/listings-service}"

echo "[run-listings-community-migrations-k8s] ns=$NAMESPACE target=$DEPLOY"

for f in 07-community-posts.sql 08-community-reports.sql 09-listing-status-archived.sql 10-community-post-flair.sql 11-community-post-images.sql 12-community-author-display.sql; do
  echo "→ $f"
  kubectl -n "$NAMESPACE" exec "$DEPLOY" -- sh -ec "
    set -euo pipefail
    test -f /app/infra/db/$f
    psql \"\${POSTGRES_URL_LISTINGS}\" -v ON_ERROR_STOP=1 -f /app/infra/db/$f
  "
done

echo "✅ Listings community schema ensured in-cluster"
