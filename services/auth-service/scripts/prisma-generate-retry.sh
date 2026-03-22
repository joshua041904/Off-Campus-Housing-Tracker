#!/usr/bin/env bash
# Prisma generate with retries — works around intermittent Apple Silicon / Node crashes:
#   assertion failed [block != nullptr]: BasicBlock requested for unrecognized address
# See: https://github.com/prisma/prisma/discussions/20739
set -euo pipefail
cd "$(dirname "$0")/.."
MAX="${PRISMA_GENERATE_RETRIES:-5}"
for attempt in $(seq 1 "$MAX"); do
  if pnpm exec prisma generate "$@"; then
    exit 0
  fi
  rc=$?
  echo "prisma generate failed (exit $rc, attempt $attempt/$MAX)" >&2
  [[ "$attempt" -lt "$MAX" ]] || exit "$rc"
  sleep "$((attempt * 2))"
done
