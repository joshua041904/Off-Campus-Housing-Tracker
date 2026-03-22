#!/usr/bin/env bash
# Run all infra/db schema scripts so every housing DB (ports 5442–5448) is set up correctly.
# Matches infra/db/README.md: listings (5442) … analytics (5447), media (5448). Auth (5441) is Prisma + optional
# restore — use scripts/restore-auth-from-legacy-dump.sh if you have a legacy dump.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/setup-all-dbs.sh
#   PGHOST=127.0.0.1 PGPASSWORD=postgres ./scripts/setup-all-dbs.sh
#
# Optional: DO_DOCKER_UP=1 to start all 8 Postgres containers before applying schemas.
# Prereq: psql on PATH (or ensure scripts will fail clearly). Ports 5441–5448.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ "${DO_DOCKER_UP:-0}" == "1" ]]; then
  say "Starting all 8 Postgres containers (ports 5441–5448)..."
  docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media 2>/dev/null || true
  echo "Waiting 5s for Postgres to accept connections..."
  sleep 5
fi

say "Setting up all housing DBs from infra/db (per infra/db/README.md)..."

# Auth (5441): Prisma + optional restore; no infra/db SQL to run here.
warn "Auth (5441): skipped — use scripts/restore-auth-from-legacy-dump.sh for legacy dump; schema is Prisma-managed."

# Listings (5442): 01 + 02 (trigram/pgbench)
say "Listings (5442)..."
"$SCRIPT_DIR/ensure-listings-schema.sh"
ok "Listings done."

# Booking (5443)
say "Booking (5443)..."
"$SCRIPT_DIR/ensure-booking-schema.sh"
ok "Booking done."

# Messaging (5444)
say "Messaging (5444)..."
"$SCRIPT_DIR/ensure-messaging-schema.sh"
ok "Messaging done."

# Notification (5445)
say "Notification (5445)..."
"$SCRIPT_DIR/ensure-notification-schema.sh"
ok "Notification done."

# Trust (5446)
say "Trust (5446)..."
"$SCRIPT_DIR/ensure-trust-schema.sh"
ok "Trust done."

# Analytics (5447)
say "Analytics (5447)..."
"$SCRIPT_DIR/ensure-analytics-schema.sh"
ok "Analytics done."

# Media (5448)
if [[ -x "$SCRIPT_DIR/ensure-media-schema.sh" ]]; then
  say "Media (5448)..."
  "$SCRIPT_DIR/ensure-media-schema.sh"
  ok "Media done."
else
  warn "ensure-media-schema.sh missing; skip media DB schema"
fi

say "=== All DBs set up ==="
echo ""
echo "Ports 5442–5448: schema applied (listings … analytics, media on 5448 when ensure-media-schema ran)."
echo "Port 5441 (auth): Prisma/restore only — run restore-auth-from-legacy-dump.sh if needed."
echo ""
echo "Optional: PGPASSWORD=postgres ./scripts/restore-good-db-settings.sh to apply tuning to all 8 instances."
