#!/usr/bin/env bash
# Bring up the external stack: Redis, MinIO, 8 Postgres. Kafka runs in-cluster (KRaft); see infra/k8s/kafka-kraft-metallb/.
# Uses docker-compose volumes (pgdata-auth, …); all have healthchecks.
# Run before preflight or k3s bring-up so pods can reach host.docker.internal:5441–5448, Redis 6380.
#
# Usage: ./scripts/bring-up-external-infra.sh
#
# Postgres runtime tuning (e.g. docker-compose `command: max_connections=400`) applies only after
# container recreate. To recycle the 8 Postgres services without wiping volumes, use:
#   ./scripts/recycle-och-postgres-compose.sh
#
#   SKIP_COMPOSE_UP=1        — only wait for already-running containers
#   ENFORCE_DB_TUNING=1      — after Postgres up, run enforce-external-db-schemas-and-tuning.sh if present
#   MAX_WAIT=180             — max seconds to wait for Redis/Postgres (default 180)
#   RESTORE_BACKUP_DIR=DIR   — after Postgres healthy, restore all 8 DBs from custom dumps only
#                              (restore-external-postgres-from-backup.sh — no infra/db SQL in this script)
#   SKIP_AUTO_RESTORE=1      — skip restore block (use when Phase-0 already restored; make up calls infra-host again)
#   RESTORE_BACKUP_DIR=latest — use newest backups/all-8-* or backups/all-7-*
#   WAIT_K8S_KAFKA=1         — after compose up, wait for kafka-0..2 Ready in off-campus-housing-tracker (optional)
#
# Examples:
#   ./scripts/bring-up-external-infra.sh
#   RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh
#
# Kafka topics (in-cluster): ./scripts/create-kafka-event-topics-k8s.sh
# Stack contract (k8s): KAFKA_CONTRACT_LIVE_TARGET=k8s KAFKA_BROKER=… ./scripts/validate-kafka-stack-contract.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MAX_WAIT="${MAX_WAIT:-180}"
SKIP_COMPOSE_UP="${SKIP_COMPOSE_UP:-0}"
ENFORCE_DB_TUNING="${ENFORCE_DB_TUNING:-0}"
WAIT_K8S_KAFKA="${WAIT_K8S_KAFKA:-0}"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

_step_n=0
step() {
  _step_n=$((_step_n + 1))
  say "Step ${_step_n}: $*"
}

# Docker / Colima
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

POSTGRES_SERVICES=(postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media)

if [[ "$SKIP_COMPOSE_UP" != "1" ]]; then
  step "Starting Redis, MinIO, Postgres (8)"
  docker compose up -d redis 2>&1 || true
  docker compose up -d minio 2>&1 || true
  docker compose up -d "${POSTGRES_SERVICES[@]}" 2>&1 || true
  info "Containers started; waiting for health (max ${MAX_WAIT}s)…"
else
  info "SKIP_COMPOSE_UP=1: only waiting for existing containers."
fi

REDIS_PORT="${REDIS_PORT:-6380}"

step "Waiting for Redis (${REDIS_PORT})"
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

if [[ "$WAIT_K8S_KAFKA" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  step "Waiting for Kubernetes Kafka pods (optional WAIT_K8S_KAFKA=1)"
  if kubectl get pod kafka-0 -n "$HOUSING_NS" &>/dev/null; then
    for _i in 0 1 2; do
      kubectl wait pod "kafka-${_i}" -n "$HOUSING_NS" --for=condition=Ready --timeout=300s 2>/dev/null || warn "kafka-${_i} not Ready in time"
    done
    ok "Kubernetes Kafka pods checked ($HOUSING_NS)"
  else
    warn "No kafka-0 in $HOUSING_NS — deploy KRaft StatefulSet first"
  fi
fi

PORTS="5441 5442 5443 5444 5445 5446 5447 5448"
elapsed=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  all_ok=true
  for port in $PORTS; do
    if ! (nc -z 127.0.0.1 "$port" 2>/dev/null || nc -z ::1 "$port" 2>/dev/null); then
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
if ! (nc -z 127.0.0.1 5441 2>/dev/null && nc -z 127.0.0.1 5448 2>/dev/null); then
  warn "Not all Postgres ports became ready within ${MAX_WAIT}s. Run: docker compose up -d ${POSTGRES_SERVICES[*]}"
fi

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
docker compose ps redis minio "${POSTGRES_SERVICES[@]}" 2>/dev/null || true
info "Kafka: in-cluster KRaft only — ./scripts/create-kafka-event-topics-k8s.sh"
say "✅ bring-up-external-infra finished. See docs/RUN_PIPELINE_ORDER.md"

RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-}"
if [[ -n "$RESTORE_BACKUP_DIR" ]] && [[ "${SKIP_AUTO_RESTORE:-0}" == "1" ]]; then
  info "SKIP_AUTO_RESTORE=1 — skipping dump restore here (already ran in an earlier phase)."
elif [[ -n "$RESTORE_BACKUP_DIR" ]]; then
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
