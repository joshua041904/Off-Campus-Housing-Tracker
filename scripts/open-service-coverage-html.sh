#!/usr/bin/env bash
# Open per-service Vitest HTML coverage reports (after pnpm run test:coverage:all).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
opened=0
for f in "$REPO_ROOT"/services/*/coverage/index.html; do
  if [[ -f "$f" ]]; then
    opened=1
    if command -v open >/dev/null 2>&1; then
      open "$f"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$f" >/dev/null 2>&1 || true
    else
      echo "$f"
    fi
  fi
done
if [[ "$opened" -eq 0 ]]; then
  echo "No services/*/coverage/index.html found. Run: pnpm run test:coverage:all" >&2
  exit 1
fi
