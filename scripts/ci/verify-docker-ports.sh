#!/usr/bin/env bash
# Invariant: docker-compose (or equivalent) must publish OCH DB ports 5441–5448 and Redis 6380.
# Run after `docker compose up` (local / Colima). Not for GitHub-hosted CI (no daemon).
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker not found."
  exit 1
fi

required_ports=(5441 5442 5443 5444 5445 5446 5447 5448 6380)
ports_blob="$(docker ps --format '{{.Ports}}' 2>/dev/null | tr '\n' ' ')"

for port in "${required_ports[@]}"; do
  if ! printf '%s' "$ports_blob" | grep -qE "(0\\.0\\.0\\.0|\\[::\\]):${port}->"; then
    echo "❌ Required host port ${port} not mapped (expected 0.0.0.0:${port}-> or [::]:${port}-> in docker ps)."
    exit 1
  fi
done

echo "✅ All required ports mapped (5441–5448 Postgres, 6380 Redis)."
