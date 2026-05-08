#!/usr/bin/env bash
# Install sample hooks into .git/hooks (run from repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for f in pre-commit pre-push; do
  install -m 0755 "$ROOT/scripts/git-hooks/${f}.sample" "$ROOT/.git/hooks/$f"
  echo "Installed .git/hooks/$f"
done
