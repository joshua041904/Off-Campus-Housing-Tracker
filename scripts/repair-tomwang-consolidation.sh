#!/usr/bin/env bash
# Consolidate tomwang04312 duplicate auth identities into canonical account.
# Dry-run by default. Pass --apply to write.
#
#   ./scripts/repair-tomwang-consolidation.sh
#   ./scripts/repair-tomwang-consolidation.sh --apply

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APPLY=()
for arg in "$@"; do
  if [[ "$arg" == "--apply" ]]; then
    APPLY=(--apply)
  fi
done

exec pnpm dlx tsx scripts/repair-restored-user-ownership.ts \
  --canonical-user-id 1b235322-10e5-4cfb-8594-6565e67e28e9 \
  --canonical-email tomwang04312@gmail.com \
  --match-username tomwang04312 \
  --include-user-id d9206c11-7afd-41bd-8b53-f85410f473b4 \
  --include-user-id ee55ecc0-617b-4d48-b350-61c08adcb3e2 \
  --include-user-id 9f9a9df4-9211-460f-a00d-dd40a523a488 \
  --dry-run-json /tmp/consolidation-dry-run.json \
  "${APPLY[@]}"
