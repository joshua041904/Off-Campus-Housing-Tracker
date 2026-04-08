#!/usr/bin/env bash
# Build docs/architecture-submission/2.1-architecture-diagram/ as a single package:
#   - assets/png/*.png   (copies from diagrams/data-modeling/png/)
#   - assets/xmi/*.xmi   (PlantUML XMI from diagrams/uml/class/*.puml)
#   - MANIFEST.json
# Prereq: run `make generate-architecture` first (or this script exits with hint).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_PNG="$REPO_ROOT/diagrams/data-modeling/png"
PKG="$REPO_ROOT/docs/architecture-submission/2.1-architecture-diagram"
PNG_OUT="$PKG/assets/png"
XMI_OUT="$PKG/assets/xmi"
STEM_SCRIPT="$REPO_ROOT/scripts/plantuml/puml-diagram-stem.sh"

run_plantuml() {
  if command -v plantuml >/dev/null 2>&1; then
    plantuml "$@"
  elif [[ "${PLANTUML_DOCKER:-0}" == "1" ]] && command -v docker >/dev/null 2>&1; then
    local args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        *.puml) args+=("${1#$REPO_ROOT/}") ; shift ;;
        *) args+=("$1"); shift ;;
      esac
    done
    docker run --rm -v "$REPO_ROOT:/repo" -w /repo plantuml/plantuml:latest "${args[@]}"
  else
    echo "plantuml not found (install or PLANTUML_DOCKER=1). Skipping XMI generation." >&2
    return 1
  fi
}

mkdir -p "$PKG" "$PNG_OUT" "$XMI_OUT"

# Rubric-oriented figure set: Graphviz + PlantUML (all per-service class + C4 L3 + physical ERs)
FIGURES=(
  data-flow.png
  domain.png
  c4-container.png
  c4-context.png
  unified-logical-er.png
  system-architecture-poster.png
  uml-component-system.png
  uml-state-booking-lifecycle.png
  uml-sequence-create-booking.png
  uml-sequence-booking-confirmation-flow.png
  uml-sequence-create-listing.png
  uml-sequence-message-sent-flow.png
  uml-sequence-flag-user-moderation-flow.png
  uml-sequence-projection-update.png
  uml-sequence-notification-dispatch.png
  physical-auth.png
  physical-listings.png
  physical-bookings.png
  physical-messaging.png
  physical-notification.png
  physical-trust.png
  physical-analytics.png
  physical-media.png
  uml-class-gateway.png
  uml-class-booking.png
  uml-class-auth.png
  uml-class-listings.png
  uml-class-messaging.png
  uml-class-notification.png
  uml-class-trust.png
  uml-class-analytics.png
  uml-class-media.png
  c4-components-gateway.png
  c4-components-booking.png
  c4-components-auth.png
  c4-components-listings.png
  c4-components-messaging.png
  c4-components-notification.png
  c4-components-trust.png
  c4-components-analytics.png
  c4-components-media.png
)

echo "=== Copy PNGs → $PNG_OUT ==="
missing=0
for f in "${FIGURES[@]}"; do
  if [[ -f "$SRC_PNG/$f" ]]; then
    cp -f "$SRC_PNG/$f" "$PNG_OUT/$f"
    echo "  $f"
  else
    echo "  SKIP (missing): $f"
    missing=$((missing + 1))
  fi
done

if [[ "$missing" -gt 0 ]]; then
  echo "WARN: $missing file(s) missing. Run: make generate-architecture" >&2
fi

echo "=== XMI (class diagrams only) → $XMI_OUT ==="
if command -v plantuml >/dev/null 2>&1 || { [[ "${PLANTUML_DOCKER:-0}" == "1" ]] && command -v docker >/dev/null 2>&1; }; then
  shopt -s nullglob
  for puml in "$REPO_ROOT/diagrams/uml/class"/*.puml; do
    base="$(basename "$puml" .puml)"
    stem="$("$STEM_SCRIPT" "$puml")"
    pdir="$(dirname "$puml")"
    if run_plantuml -charset UTF-8 -txmi "$puml" 2>/dev/null; then
      if [[ -f "$pdir/${stem}.xmi" ]]; then
        mv -f "$pdir/${stem}.xmi" "$XMI_OUT/${base}.xmi"
        echo "  ${base}.xmi"
      fi
    fi
  done
  shopt -u nullglob
else
  echo "  (skipped — no plantuml)"
fi

# Manifest for ZIP / LMS upload (valid JSON)
python3 - "$PKG" "$PNG_OUT" "$XMI_OUT" <<'PY'
import json, os, sys, datetime
pkg, png_dir, xmi_dir = sys.argv[1:4]
def entries(d, prefix):
    out = []
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        if os.path.isfile(path):
            out.append({"file": prefix + name, "bytes": os.path.getsize(path)})
    return out
manifest = {
    "package": "2.1-architecture-diagram",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "png": entries(png_dir, "assets/png/"),
    "xmi": entries(xmi_dir, "assets/xmi/"),
}
with open(os.path.join(pkg, "MANIFEST.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
PY

echo "=== Wrote $PKG/MANIFEST.json ==="
echo "Done. Open docs/architecture-submission/2.1-architecture-diagram/SUBMISSION.md"
