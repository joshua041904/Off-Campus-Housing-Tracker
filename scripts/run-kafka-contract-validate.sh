#!/usr/bin/env bash
# Build kafka-contract and run CLI validate with forwarded args (e.g. --json).
# Usage: bash scripts/run-kafka-contract-validate.sh [--json] ...
#   pnpm run kafka-contract:validate -- --json
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
pnpm --filter kafka-contract run build
exec node tools/kafka-contract/dist/index.js validate "$@"
