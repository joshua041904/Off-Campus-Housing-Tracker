#!/usr/bin/env bash
# Render all PlantUML under diagrams/uml/ and diagrams/c4/ → diagrams/data-modeling/png/
# Names: path with slashes → hyphens (e.g. uml-class-booking.png, c4-components-analytics.png).
# Resolves actual PNG/SVG/XMI filenames from @startuml <id> (PlantUML names outputs after <id>, not the .puml basename).
# Optional: PLANTUML_EXTRA_FORMATS=svg,xmi for diagrams/data-modeling/{svg-uml,xmi-uml}/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIAGRAMS="$REPO_ROOT/diagrams"
PNG_ROOT="${PLANTUML_PNG_ROOT:-$DIAGRAMS/data-modeling/png}"
SVG_ROOT="$DIAGRAMS/data-modeling/svg-uml"
XMI_ROOT="$DIAGRAMS/data-modeling/xmi-uml"
STEM_SCRIPT="$SCRIPT_DIR/puml-diagram-stem.sh"

run_plantuml() {
  if command -v plantuml >/dev/null 2>&1; then
    plantuml "$@"
  elif [[ "${PLANTUML_DOCKER:-0}" == "1" ]] && command -v docker >/dev/null 2>&1; then
    local args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        *.puml)
          args+=("${1#$REPO_ROOT/}")
          shift ;;
        *)
          args+=("$1")
          shift ;;
      esac
    done
    docker run --rm -v "$REPO_ROOT:/repo" -w /repo plantuml/plantuml:latest "${args[@]}"
  else
    echo "plantuml not found. Install: brew install plantuml graphviz (macOS) or apt install plantuml graphviz (Linux)." >&2
    echo "Or set PLANTUML_DOCKER=1 and use Docker (plantuml/plantuml image)." >&2
    exit 1
  fi
}

mkdir -p "$PNG_ROOT"

slugify() {
  local rel="$1"
  rel="${rel%.puml}"
  echo "${rel//\//-}"
}

render_one() {
  local puml="$1"
  local rel="${puml#$DIAGRAMS/}"
  local slug
  slug="$(slugify "$rel")"
  local pdir stem png_src
  pdir="$(dirname "$puml")"
  stem="$("$STEM_SCRIPT" "$puml")"
  png_src="$pdir/${stem}.png"

  run_plantuml -charset UTF-8 -tpng "$puml"
  [[ -f "$png_src" ]] || { echo "missing $png_src (expected stem \"$stem\" from $puml)" >&2; exit 1; }
  mv -f "$png_src" "$PNG_ROOT/${slug}.png"
  echo "  $PNG_ROOT/${slug}.png"

  if [[ -n "${PLANTUML_EXTRA_FORMATS:-}" ]]; then
    if [[ ",$PLANTUML_EXTRA_FORMATS," == *",svg,"* ]]; then
      mkdir -p "$SVG_ROOT"
      run_plantuml -charset UTF-8 -tsvg "$puml"
      local svg_src="$pdir/${stem}.svg"
      [[ -f "$svg_src" ]] || { echo "missing $svg_src" >&2; exit 1; }
      mv -f "$svg_src" "$SVG_ROOT/${slug}.svg"
      echo "  $SVG_ROOT/${slug}.svg"
    fi
    if [[ ",$PLANTUML_EXTRA_FORMATS," == *",xmi,"* ]]; then
      mkdir -p "$XMI_ROOT"
      run_plantuml -charset UTF-8 -txmi "$puml" 2>/dev/null || true
      local xmi_src="$pdir/${stem}.xmi"
      if [[ -f "$xmi_src" ]]; then
        mv -f "$xmi_src" "$XMI_ROOT/${slug}.xmi"
        echo "  $XMI_ROOT/${slug}.xmi"
      fi
    fi
  fi
}

echo "=== PlantUML → $PNG_ROOT ==="
count=0
while IFS= read -r -d '' f; do
  render_one "$f"
  count=$((count + 1))
done < <(find "$DIAGRAMS/uml" "$DIAGRAMS/c4" -name '*.puml' -print0 2>/dev/null | sort -z)

if [[ "$count" -eq 0 ]]; then
  echo "No .puml files under $DIAGRAMS/uml or $DIAGRAMS/c4" >&2
  exit 1
fi

echo "Done. $count diagram(s)."
