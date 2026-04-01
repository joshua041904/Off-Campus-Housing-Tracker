#!/usr/bin/env bash
# Render Graphviz DOT → SVG and PNG (grouped outputs).
# Usage: ./render.sh <in.dot> <out.svg> [out.png]
#   If out.png omitted, writes <out.svg> with .png extension (same directory).
#   SKIP_PNG=1 skips PNG. DOT_DPI controls PNG density (default 200; use 300 for poster).
set -euo pipefail

dot_file="${1:?dot}"
svg_out="${2:?svg}"
png_out="${3:-}"

command -v dot >/dev/null || { echo "Graphviz (dot) not installed. macOS: brew install graphviz; Ubuntu: apt install graphviz" >&2; exit 1; }

mkdir -p "$(dirname "$svg_out")"
dot -Tsvg "$dot_file" -o "$svg_out"

dpi="${DOT_DPI:-200}"
if [[ "${SKIP_PNG:-0}" == "1" ]]; then
  exit 0
fi
if [[ -z "$png_out" ]]; then
  png_out="${svg_out%.svg}.png"
  [[ "$png_out" == "$svg_out" ]] && png_out="${svg_out}.png"
fi
mkdir -p "$(dirname "$png_out")"
dot -Tpng -Gdpi="$dpi" "$dot_file" -o "$png_out"
