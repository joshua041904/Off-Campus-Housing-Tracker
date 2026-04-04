#!/usr/bin/env bash
# Regenerate diagrams + copy into docs/architecture for onboarding / ER index.
# PNGs live under diagrams/data-modeling/png/; this script maps them into docs paths.
# Usage: ./scripts/diagram/generate-architecture-docs.sh [output_diagram_root]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIAG="${1:-$REPO_ROOT/diagrams}"
PNG="$DIAG/data-modeling/png"

bash "$SCRIPT_DIR/clean-data-modeling-png.sh"
"$SCRIPT_DIR/generate-all.sh" "$DIAG"
if command -v plantuml >/dev/null 2>&1 || { [[ "${PLANTUML_DOCKER:-0}" == "1" ]] && command -v docker >/dev/null 2>&1; }; then
  bash "$REPO_ROOT/scripts/plantuml/render-all.sh"
else
  echo "WARN: Skipping PlantUML (install plantuml / graphviz, or PLANTUML_DOCKER=1 with Docker)." >&2
fi
"$SCRIPT_DIR/generate-service-arch-docs.sh" "$REPO_ROOT"

ARCH="$REPO_ROOT/docs/architecture"
mkdir -p "$ARCH/domain" "$ARCH/physical" "$ARCH/runtime" "$ARCH/poster"

cp -f "$DIAG/domain/unified-logical-er.svg" "$ARCH/domain/" 2>/dev/null || true
cp -f "$DIAG/domain/domain.svg" "$ARCH/domain/" 2>/dev/null || true
cp -f "$PNG/unified-logical-er.png" "$ARCH/domain/" 2>/dev/null || true
cp -f "$PNG/domain.png" "$ARCH/domain/" 2>/dev/null || true

cp -f "$DIAG/flow/data-flow.svg" "$ARCH/runtime/" 2>/dev/null || true
cp -f "$PNG/data-flow.png" "$ARCH/runtime/" 2>/dev/null || true

cp -f "$DIAG/poster/system-architecture.svg" "$ARCH/poster/" 2>/dev/null || true
cp -f "$PNG/system-architecture-poster.png" "$ARCH/poster/system-architecture.png" 2>/dev/null || true

cp -f "$DIAG/physical"/*.svg "$ARCH/physical/" 2>/dev/null || true
for svc in auth listings bookings messaging notification trust analytics media; do
  [[ -f "$PNG/physical-${svc}.png" ]] || continue
  cp -f "$PNG/physical-${svc}.png" "$ARCH/physical/${svc}.png"
done

echo "Architecture docs synced under $ARCH (see README.md + er-index.md)."
