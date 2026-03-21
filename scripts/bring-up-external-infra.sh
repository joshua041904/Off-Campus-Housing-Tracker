#!/usr/bin/env bash
# Bring up the external stack: Zookeeper, Kafka (SSL), Redis, and 7 Postgres instances (housing platform).
# Uses docker-compose volumes (pgdata-auth, pgdata-listings, etc.); all have healthchecks.
# Run before preflight or k8s bring-up so pods can reach host.docker.internal:5441–5447, Redis 6380, Kafka 29094.
# Housing uses 6380/29094/2182 so it does not conflict with record platform (6379/29093/2181).
#
# Usage: ./scripts/bring-up-external-infra.sh
#   SKIP_KAFKA=1             — do not start Kafka (e.g. certs not ready)
#   SKIP_COMPOSE_UP=1        — only wait for already-running containers
#   ENFORCE_DB_TUNING=1      — after Postgres up, run enforce-external-db-schemas-and-tuning.sh if present
#   MAX_WAIT=180             — max seconds to wait for all services (default 180)
#   RESTORE_BACKUP_DIR=DIR   — after Postgres healthy, restore all 8 DBs from backup dir (e.g. backups/all-8-20260318-174510)
#   RESTORE_BACKUP_DIR=latest — use newest backups/all-8-* or backups/all-7-* directory (prefer all-8-*)
#
# Examples (restore is optional; by default no restore is run):
#   ./scripts/bring-up-external-infra.sh
#   RESTORE_BACKUP_DIR=backups/all-8-20260318-174510 ./scripts/bring-up-external-infra.sh
#   RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh
#
# Kafka requires certs in ./certs/kafka-ssl (keystore, truststore, passwords). See Runbook "Kafka SSL".
# Volumes: pgdata-auth, pgdata-listings, pgdata-bookings, pgdata-messaging, pgdata-notification, pgdata-trust, pgdata-analytics

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MAX_WAIT="${MAX_WAIT:-180}"
SKIP_KAFKA="${SKIP_KAFKA:-0}"
SKIP_COMPOSE_UP="${SKIP_COMPOSE_UP:-0}"
ENFORCE_DB_TUNING="${ENFORCE_DB_TUNING:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

TOTAL_STEPS="${TOTAL_STEPS:-9}"
_step_n=0
step() {
  _step_n=$((_step_n + 1))
  say "Step ${_step_n}/${TOTAL_STEPS}: $*"
}

# Docker available? When Colima is running, point CLI at it so docker info succeeds.
# Prefer socket when Colima VM is up (colima list shows Running); colima status can fail with "empty value".
if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found. Install Docker or start Colima."
  exit 1
fi
if command -v colima >/dev/null 2>&1; then
  _colima_running=$(colima list 2>/dev/null | awk '/default/ && /Running/ { print "1" }')
  if [[ "$_colima_running" == "1" ]]; then
    docker context use colima 2>/dev/null || true
    for sock in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock"; do
      if [[ -S "$sock" ]] || [[ -f "$sock" ]]; then
        export DOCKER_HOST="unix://$sock"
        break
      fi
    done
  fi
  # If DOCKER_HOST still not set, try colima status (older path)
  if [[ -z "${DOCKER_HOST:-}" ]] && colima status 2>/dev/null | grep -q "colima is running"; then
    docker context use colima 2>/dev/null || true
    for sock in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock"; do
      if [[ -S "$sock" ]] || [[ -f "$sock" ]]; then
        export DOCKER_HOST="unix://$sock"
        break
      fi
    done
  fi
fi
if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon not reachable. Start Colima: colima start --with-kubernetes"
  info "If Colima is already running, try: docker context use colima"
  exit 1
fi

# Kafka SSL: docker-compose mounts ./certs/kafka-ssl
if [[ "$SKIP_KAFKA" != "1" ]]; then
  if [[ ! -d "certs/kafka-ssl" ]] || [[ ! -f "certs/kafka-ssl/kafka.keystore.jks" ]]; then
    warn "Kafka uses strict TLS; certs/kafka-ssl/ (kafka.keystore.jks, etc.) not found. Set SKIP_KAFKA=1 to skip Kafka, or create certs (see Runbook 'Kafka SSL', or pnpm run kafka-ssl / kafka-ssl-from-dev-root.sh)."
    read -r -p "Continue without Kafka? [y/N] " r
    if [[ "${r:-n}" != "y" ]] && [[ "${r:-n}" != "Y" ]]; then
      exit 1
    fi
    SKIP_KAFKA=1
  fi
fi

step "Bringing up external infra (Zookeeper, Kafka, Redis, MinIO, 8 Postgres)"
info "Volumes: pg-auth, pg-listings, pg-bookings, pg-messaging, pg-notification, pg-trust, pg-analytics, pg-media, minio_data"

# Single line for all postgres service names so the command cannot be broken by line wrap
POSTGRES_SERVICES="postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media"

if [[ "$SKIP_COMPOSE_UP" != "1" ]]; then
  step "Starting Zookeeper, then Kafka (if certs OK), Redis, MinIO, Postgres (docker compose)"
  # Start in dependency order: zookeeper first, then kafka (depends_on zookeeper), redis, then all postgres
  docker compose up -d zookeeper 2>&1 || true
  sleep 3
  if [[ "$SKIP_KAFKA" != "1" ]]; then
    docker compose up -d kafka 2>&1 || true
    sleep 2
  else
    info "Skipping Kafka (SKIP_KAFKA=1 or certs missing)."
  fi
  docker compose up -d redis 2>&1 || true
  docker compose up -d minio 2>&1 || true
  docker compose up -d $POSTGRES_SERVICES 2>&1 || true
  info "Containers started; waiting for health (max ${MAX_WAIT}s)..."
else
  info "SKIP_COMPOSE_UP=1: only waiting for existing containers."
fi

REDIS_PORT="${REDIS_PORT:-6380}"
KAFKA_SSL_PORT="${KAFKA_SSL_PORT:-29094}"

step "Waiting for Redis (${REDIS_PORT})"
# Wait for Redis (port 6380 for housing; RP uses 6379)
elapsed=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  if nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
    ok "Redis ($REDIS_PORT): reachable"
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done
if ! nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
  warn "Redis ($REDIS_PORT) not reachable after ${MAX_WAIT}s."
fi

step "Waiting for Kafka SSL (${KAFKA_SSL_PORT}) (if started)"
# Wait for Kafka SSL port 29094 (if we started it; RP uses 29093)
if [[ "$SKIP_KAFKA" != "1" ]]; then
  elapsed=0
  while [[ $elapsed -lt $MAX_WAIT ]]; do
    if nc -z 127.0.0.1 "$KAFKA_SSL_PORT" 2>/dev/null; then
      ok "Kafka ($KAFKA_SSL_PORT): reachable"
      break
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  if ! nc -z 127.0.0.1 "$KAFKA_SSL_PORT" 2>/dev/null; then
    warn "Kafka ($KAFKA_SSL_PORT) not reachable after ${MAX_WAIT}s. Check certs/kafka-ssl and docker compose logs kafka."
  fi
fi

# Wait for all 8 Postgres ports (5441–5448)
PORTS="5441 5442 5443 5444 5445 5446 5447 5448"
elapsed=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  all_ok=true
  for port in $PORTS; do
    if ! ( nc -z 127.0.0.1 "$port" 2>/dev/null || nc -z ::1 "$port" 2>/dev/null ); then
      all_ok=false
      break
    fi
  done
  if [[ "$all_ok" == "true" ]]; then
    ok "All 8 Postgres ports (5441–5448) reachable."
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done
if ! ( nc -z 127.0.0.1 5441 2>/dev/null && nc -z 127.0.0.1 5448 2>/dev/null ); then
  warn "Not all Postgres ports became ready within ${MAX_WAIT}s. Run: docker compose up -d $POSTGRES_SERVICES"
fi

# Optional: enforce DB tuning/schemas (script may not exist)
if [[ "$ENFORCE_DB_TUNING" == "1" ]]; then
  if [[ -x "$SCRIPT_DIR/enforce-external-db-schemas-and-tuning.sh" ]]; then
    step "Enforcing DB schemas and tuning (ENFORCE_DB_TUNING=1)"
    "$SCRIPT_DIR/enforce-external-db-schemas-and-tuning.sh" || warn "enforce-external-db-schemas-and-tuning.sh failed (non-fatal)."
  else
    info "ENFORCE_DB_TUNING=1 but enforce-external-db-schemas-and-tuning.sh not found; skip."
  fi
fi

step "Summary — container status"
say "=== External infra status ==="
docker compose ps zookeeper kafka redis minio $POSTGRES_SERVICES 2>/dev/null || true
info "Next: ./scripts/ensure-external-databases-created.sh  then  ./scripts/setup-metallb-and-namespaces.sh  then deploy k8s (or run preflight)."
say "✅ bring-up-external-infra finished (see steps above). Full order: docs/RUN_PIPELINE_ORDER.md"

# ------------------------------------------------------------
# Optional: auto-restore from backup directory (after infra healthy).
# Must be after all if/fi blocks so bash structure stays valid.
# ------------------------------------------------------------
RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-}"
if [[ -n "$RESTORE_BACKUP_DIR" ]]; then
  echo
  echo "=== Auto-restore requested: $RESTORE_BACKUP_DIR ==="
  if [[ "$RESTORE_BACKUP_DIR" == "latest" ]]; then
    RESTORE_BACKUP_DIR=$(ls -d backups/all-8-* 2>/dev/null | sort -r | head -1)
    [[ -z "$RESTORE_BACKUP_DIR" ]] && RESTORE_BACKUP_DIR=$(ls -d backups/all-7-* 2>/dev/null | sort -r | head -1)
    [[ -z "$RESTORE_BACKUP_DIR" ]] && { echo "ERROR: RESTORE_BACKUP_DIR=latest but no backups/all-8-* or backups/all-7-* found."; exit 1; }
  fi
  if [[ ! -d "$RESTORE_BACKUP_DIR" ]]; then
    echo "ERROR: Restore directory not found: $RESTORE_BACKUP_DIR"
    exit 1
  fi
  "$SCRIPT_DIR/restore-external-postgres-from-backup.sh" "$RESTORE_BACKUP_DIR"
fi

if [[ -z "${RESTORE_BACKUP_DIR:-}" ]]; then
  info "Heads-up: No DB restore was run. To restore all 8 DBs from backup, re-run with RESTORE_BACKUP_DIR=latest  or  RESTORE_BACKUP_DIR=backups/all-8-<timestamp>"
fi
 