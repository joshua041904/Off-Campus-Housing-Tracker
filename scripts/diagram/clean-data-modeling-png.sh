#!/usr/bin/env bash
# Remove raster outputs under diagrams/data-modeling/png/ so the next
# `make generate-architecture` repopulates from Graphviz + PlantUML only (no stale files).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PNG_DIR="$REPO_ROOT/diagrams/data-modeling/png"
if [[ ! -d "$PNG_DIR" ]]; then
  mkdir -p "$PNG_DIR"
  exit 0
fi
shopt -s nullglob
for f in "$PNG_DIR"/*.png; do
  rm -f "$f"
done
shopt -u nullglob
echo "Cleared $PNG_DIR/*.png"
