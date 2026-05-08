#!/usr/bin/env bash
# Fail fast when docker build is invoked with the wrong context (monorepo root required).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REQUIRED=(
  proto
  services/common
  services/api-gateway
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
)

for path in "${REQUIRED[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "::error::verify-build-context: missing $path (cwd=$ROOT)"
    echo "  Docker builds for api-gateway must use: docker build -f services/api-gateway/Dockerfile ."
    exit 1
  fi
done

echo "✅ verify-build-context: monorepo paths OK"
