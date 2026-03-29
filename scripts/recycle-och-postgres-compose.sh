#!/usr/bin/env bash
# Safe recycle of the 8 OCH Postgres containers so docker-compose.yml runtime flags apply
# (e.g. max_connections=400). Does NOT remove volumes — data stays on disk.
#
# Use after changing Postgres `command:` or image in docker-compose.yml. No backup restore
# unless you choose to run restore separately (schema unchanged for max_connections-only changes).
#
# Usage (repo root):
#   ./scripts/recycle-och-postgres-compose.sh
#
# Env:
#   COMPOSE_FILE          — default: docker-compose.yml
#   VERIFY_MAX_CONNECTIONS — 1 (default): psql SHOW max_connections on 5441 + 5443
#   EXPECTED_MAX_CONN     — default 400
#   PGPASSWORD            — default postgres
#   SKIP_VERIFY           — 1: skip psql checks (e.g. psql not installed)
#
# After this, on k8s: re-apply Envoy ConfigMap if changed, rollout restart app deployments
# so app-side pool sizes refresh. Then re-run protocol matrix and extract-protocol-matrix.js.
#
# See also: ./scripts/bring-up-external-infra.sh (full stack bring-up; optional RESTORE_BACKUP_DIR)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

POSTGRES_SERVICES=(
  postgres-auth
  postgres-listings
  postgres-bookings
  postgres-messaging
  postgres-notification
  postgres-trust
  postgres-analytics
  postgres-media
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not reachable" >&2
  exit 1
fi

say "Step 1/4: docker compose stop (8 Postgres only)"
docker compose stop "${POSTGRES_SERVICES[@]}"

say "Step 2/4: docker compose rm -f (no -v — volumes retained)"
docker compose rm -f "${POSTGRES_SERVICES[@]}"

say "Step 3/4: docker compose up -d (8 Postgres)"
docker compose up -d "${POSTGRES_SERVICES[@]}"

say "Step 4/4: wait for ports 5441–5448 (up to 120s)"
MAX_WAIT="${MAX_WAIT:-120}"
elapsed=0
PORTS=(5441 5442 5443 5444 5445 5446 5447 5448)
all_ok=false
while [[ "$elapsed" -lt "$MAX_WAIT" ]]; do
  all_ok=true
  for port in "${PORTS[@]}"; do
    if ! (nc -z 127.0.0.1 "$port" 2>/dev/null || nc -z ::1 "$port" 2>/dev/null); then
      all_ok=false
      break
    fi
  done
  if [[ "$all_ok" == true ]]; then
    ok "All Postgres ports reachable"
    break
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done
if [[ "$all_ok" != true ]]; then
  warn "Some Postgres ports not ready after ${MAX_WAIT}s — check: docker compose ps ${POSTGRES_SERVICES[*]}"
fi

VERIFY_MAX_CONNECTIONS="${VERIFY_MAX_CONNECTIONS:-1}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"
EXPECTED_MAX_CONN="${EXPECTED_MAX_CONN:-400}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ "$SKIP_VERIFY" == "1" ]]; then
  warn "SKIP_VERIFY=1 — not running psql checks"
elif [[ "$VERIFY_MAX_CONNECTIONS" != "1" ]]; then
  info "VERIFY_MAX_CONNECTIONS is not 1 — skipping psql"
elif ! command -v psql >/dev/null 2>&1; then
  warn "psql not installed — install postgresql-client or set SKIP_VERIFY=1"
else
  check_port() {
    local port="$1"
    local db="$2"
    local val
    val="$(psql -h 127.0.0.1 -p "$port" -U postgres -d "$db" -t -A -c "SHOW max_connections;" 2>/dev/null | tr -d '[:space:]')"
    if [[ "$val" == "$EXPECTED_MAX_CONN" ]]; then
      ok "127.0.0.1:$port ($db) max_connections=$val"
    else
      echo "❌ 127.0.0.1:$port ($db) max_connections='$val' (expected $EXPECTED_MAX_CONN)" >&2
      exit 1
    fi
  }
  say "Verify SHOW max_connections (expected $EXPECTED_MAX_CONN)"
  check_port 5441 auth
  check_port 5443 bookings
fi

say "Done. Data volumes were not removed."
echo ""
echo "Next (k8s, if you changed Envoy / app pool defaults):"
echo "  kubectl apply -f infra/k8s/ingress-nginx-envoy.yaml   # if edited"
echo "  ./scripts/rollout-restart-och-after-pool-tuning.sh"
echo "Then re-run protocol matrix (k6) and:"
echo "  EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1 node scripts/perf/extract-protocol-matrix.js"
echo "  cat bench_logs/performance-lab/protocol-matrix-anomalies.json"
