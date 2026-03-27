#!/usr/bin/env bash
# List workspace packages under services/ whose package.json has no "test" script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
missing=0
while IFS= read -r -d '' pkg; do
  if ! grep -q '"test"' "$pkg" 2>/dev/null; then
    echo "NO_TEST_SCRIPT: $pkg"
    missing=$((missing + 1))
  fi
done < <(find "$ROOT/services" -maxdepth 2 -name package.json -print0 | sort -z)
if [[ "$missing" -eq 0 ]]; then
  echo "All direct services/*/package.json define a test script."
fi
exit 0
