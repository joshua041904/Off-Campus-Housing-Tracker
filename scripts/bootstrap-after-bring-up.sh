#!/usr/bin/env bash
# After bring-up-external-infra.sh: bootstrap all DBs from infra/db, then restore auth from backups/5437-auth.dump if present.
# Expects Postgres on 5441–5447 (and optionally 5448 for media). Redis and Kafka already up (6380, 9092/29094).
#
# Usage:
#   ./scripts/bring-up-external-infra.sh
#   PGPASSWORD=postgres ./scripts/bootstrap-after-bring-up.sh
#
# For 7 DBs only (no media): MEDIA_DB_PORT=5444 BOOTSTRAP_SKIP_MEDIA=1 or run bootstrap-all-dbs.sh and skip media manually.
# This script runs full bootstrap (all 8); if you have no Postgres on 5448, set BOOTSTRAP_ONLY to a list or run bootstrap-all-dbs.sh with DROP_IF_EXISTS and omit media.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

say "=== Bootstrap all DBs from infra/db (after bring-up) ==="
# If port 5448 (media) is not up (e.g. only 7 Postgres), skip media so bootstrap succeeds.
if ! ( nc -z 127.0.0.1 5448 2>/dev/null || nc -z ::1 5448 2>/dev/null ); then
  export BOOTSTRAP_SKIP_MEDIA=1
  warn "Port 5448 not reachable; skipping media DB (bootstrap 7 only)."
fi
DROP_IF_EXISTS=true ./scripts/bootstrap-all-dbs.sh
ok "Bootstrap done."

say "=== Restore auth dump if present ==="
if [[ -f backups/5437-auth.dump || -f backups/5437-auth.dump.gz || -f backups/5437-auth.dump.zip ]]; then
  PGPORT=5441 ./scripts/restore-auth-db.sh
  PGPORT=5441 ./scripts/verify-auth-integrity.sh
  ok "Auth restore done."
else
  warn "No backups/5437-auth.dump (.gz/.zip); skipping auth restore."
fi

say "=== Done ==="
echo "Next: ./scripts/verify-bootstrap.sh (optional), then deploy or run tests."
