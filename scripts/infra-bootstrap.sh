#!/usr/bin/env bash
# Single entry: Kafka topics + verify + booking Prisma + listings community SQL + app rollouts.
# Usage from repo root: ./scripts/infra-bootstrap.sh   or   make infra-bootstrap
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export KAFKA_K8S_SKIP_API_HEALTH="${KAFKA_K8S_SKIP_API_HEALTH:-1}"

echo "▶ Kafka: create / align topics"
bash "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh"

echo "▶ Kafka: verify required topics exist"
bash "$SCRIPT_DIR/verify-kafka-required-topics-k8s.sh"

echo "▶ Booking: Prisma migrate deploy (in-cluster)"
bash "$SCRIPT_DIR/run-booking-migrations-k8s.sh"

echo "▶ Listings: community SQL (in-cluster)"
bash "$SCRIPT_DIR/run-listings-community-migrations-k8s.sh"

NS="${K8S_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"
echo "▶ Rollout restart (ns=$NS)"
kubectl -n "$NS" rollout restart deploy/booking-service deploy/listings-service deploy/notification-service
kubectl -n "$NS" rollout status deploy/booking-service --timeout=180s
kubectl -n "$NS" rollout status deploy/listings-service --timeout=180s
kubectl -n "$NS" rollout status deploy/notification-service --timeout=180s

echo "✅ infra-bootstrap complete"
